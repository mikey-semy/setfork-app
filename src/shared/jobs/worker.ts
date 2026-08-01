import 'server-only'
import { captureError, log } from '@/shared/observability'
import { JOB_TYPES, type JobType } from '@/shared/db'
import {
  claimJob,
  claimUnfinalizedJobs,
  cleanupTerminalJobs,
  completeJob,
  failJob,
  finalizeExhausted,
  markFinalized,
  reapStalledJobs,
  touchJob,
  type Job,
} from './queue'
import { AUTONOMOUS_LOOPS, recordAgentAction } from '@/shared/agents/policy'

/** Записать падение задачи ПЕТЛИ в журнал действий (обычные задачи туда не пишем). */
async function recordLoopFailure(jobType: string, e: unknown): Promise<void> {
  if (!(AUTONOMOUS_LOOPS as readonly string[]).includes(jobType)) return
  try {
    await recordAgentAction({
      loop: jobType,
      action: 'job.run',
      resultStatus: 'error',
      signal: {},
      decision: { what: 'задача петли упала' },
      error: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
    })
  } catch {
    // Журнал — наблюдение, а не работа: если не записалось, падение задачи важнее.
  }
}

/** Обработчик задачи. Второй аргумент — сама джоба (attempts/maxAttempts)
 *  для обработчиков, которым важен номер попытки (moderate: fail-open на последней). */
export type JobHandler = (payload: unknown, job: Job) => Promise<void>

/**
 * «Задача умерла окончательно» — попытки кончились или её похоронил reaper после смерти
 * воркера. Нужен фичам, у которых есть ВИДИМОЕ состояние «в процессе»: генерация ставит
 * 'pending' до старта и снимает его в своём finally, но упавший процесс до finally не
 * доходит — и на экране остаётся вечный спиннер. Необязателен: у большинства типов задач
 * такого состояния нет, им хватает записи в таблице.
 */
export type JobFinalizer = (payload: unknown, job: Job) => Promise<void>

const POLL_MS = 3000
const BATCH = 50 // максимум задач за тик — чтобы не голодать event loop
// Сколько задач обрабатываем ОДНОВРЕМЕННО. Генерация — ожидание сети, а не CPU. НО: один совет — это
// НЕ один вызов, а ~9.5 вызовов OpenRouter (распорядитель + эксперты + новатор + критик + синтез +
// веб-поиск). Живой бенч (research/2026-07-18-council-bench) это доказал и опроверг прежнюю оценку
// «1 сокет/совет → можно 100»: при 100 советах в полёте это ~950 одновременных вызовов, они начинают
// контендить и не укладываются в таймаут → каскад отказов. «Стена сокетов 5-10K» мерила raw-TCP, не
// то. Реальный потолок — контеншн вызовов модели. 12 советов ≈ ~115 вызовов в полёте — держит их
// быстрыми под таймаутом 120с. Поднимать env'ом ТОЛЬКО после замера доли отказов, не по числу сокетов.
const CONCURRENCY = Math.max(1, Number(process.env.SETFORK_JOB_CONCURRENCY) || 12)
// Пульс живой задачи. 15с против минутного порога смерти в reaper — три пропуска подряд, чтобы
// одна залипшая запись в БД не выглядела похоронами. Дешёвый UPDATE одной строки по первичному
// ключу: даже при 12 задачах в полёте это ~1 запрос в секунду на весь инстанс.
const HEARTBEAT_MS = 15_000
// Уборка терминальных задач — раз в час (1200 тиков × 3с). Чаще незачем: выдержка измеряется
// сутками, а каждый проход это DELETE по горячей таблице.
const CLEANUP_EVERY_TICKS = 1200

let started = false

/**
 * Запускает фоновый воркер очереди (idempotent — второй вызов игнорируется).
 * Реестр обработчиков по типу задачи передаёт composition root
 * (instrumentation.ts) — shared/jobs про фичи не знает. Вызывается из
 * instrumentation.register() на старте Node-сервера. Между инстансами
 * задачи не дублируются за счёт FOR UPDATE SKIP LOCKED в claimJob.
 *
 * На старте проверяется ПОЛНОТА реестра по JOB_TYPES: забытый обработчик роняет запуск с
 * внятной ошибкой. Так уже уезжало в прод дважды — `feedpull` без самозапуска и `gnome_task`
 * без обработчика вовсе. Пусть об этом говорит старт, а не failed-задачи через неделю.
 */
export function startWorker(handlers: Record<string, JobHandler>, finalizers: Record<string, JobFinalizer> = {}): void {
  if (started) return
  started = true

  // ПОЛНОТА РЕЕСТРА — на старте, а не в проде по failed-задачам. Забытый обработчик
  // означает, что задачи этого типа ставятся, падают с «no handler» и после ретраев тихо
  // уходят в failed: фича написана, но не исполняется ни разу. Так уехал `gnome_task`.
  const missing = JOB_TYPES.filter((t) => !handlers[t])
  if (missing.length) {
    throw new Error(
      `[jobs] нет обработчика для типов задач: ${missing.join(', ')}. ` +
        'Зарегистрируй их в instrumentation.ts — иначе такие задачи будут молча уходить в failed.',
    )
  }

  const finalizedTypes = Object.keys(finalizers)

  /**
   * Похороны задачи — фича закрывает своё «в процессе».
   *
   * Успех ОТМЕЧАЕМ в задаче: без отметки повтор не отличить от первого раза. Падение не
   * роняет цикл (финализатор и так зовётся по факту чужой аварии) и НЕ отмечается — такую
   * задачу доберёт периодический проход ниже, пока похороны не состоятся. Финализаторы
   * обязаны быть идемпотентными: повтор здесь штатный, а не исключительный.
   */
  const finalize = async (job: Job): Promise<void> => {
    const fin = finalizers[job.type]
    if (!fin) return
    try {
      await fin(job.payload, job)
      await markFinalized([job.id])
    } catch (e) {
      // Попытки кончились — это уже не «повторим на следующем проходе», а тревога: состояние
      // фичи так и осталось незакрытым, дальше нужен человек. Больше эту задачу не берём
      // (счётчик вырос при захвате), поэтому шумим один раз и по делу.
      captureError(e, {
        where: 'jobs.finalize',
        jobType: job.type,
        jobId: job.id,
        finalizeAttempts: job.finalizeAttempts ?? 1,
        exhausted: finalizeExhausted(job),
      })
    }
  }

  const processOne = async (job: Job): Promise<void> => {
    // Проверку на отсутствие оставляем и здесь: в базе может лежать тип от старой версии кода.
    const handler = handlers[job.type]
    // Пульс на всё время обработки: пока он бьётся, reaper знает, что процесс жив, и не
    // отбирает задачу — даже если она честно идёт десять минут. Сбой пульса глушим: не
    // достучались до базы одним UPDATE — работу из-за этого ронять нельзя.
    const beat = setInterval(() => void touchJob(job.id, job.attempts).catch(() => {}), HEARTBEAT_MS)
    try {
      if (!handler) throw new Error(`no handler for job type: ${job.type}`)
      await handler(job.payload, job)
      await completeJob(job.id)
    } catch (e) {
      captureError(e, { where: 'jobs.handle', jobType: job.type, jobId: job.id })
      // ПАДЕНИЕ ПЕТЛИ — в журнал действий, а не только в таблицу задач. Предохранитель
      // считает серию ошибок по журналу, а туда падения не писал никто: пять подряд
      // упавших проходов оставляли журнал чистым, и «пять ошибок подряд» не наступало
      // никогда. То есть предохранитель был описан, но не мог сработать.
      await recordLoopFailure(job.type, e)
      if (await failJob(job, e instanceof Error ? e.message : String(e))) await finalize(job)
    } finally {
      // Пульс обязан замолчать вместе с работой — иначе завершённая задача «дышала» бы вечно,
      // а таймер держал бы процесс и ссылку на неё.
      clearInterval(beat)
    }
  }

  let running = false
  let ticks = 0
  const tick = async () => {
    if (running) return
    running = true
    try {
      // Раз в ~минуту (20 тиков × 3с) возвращаем в очередь джобы, зависшие в
      // `processing` после падения воркера, — иначе они терялись навсегда.
      if (ticks++ % 20 === 0) {
        const { reaped, abandoned } = await reapStalledJobs()
        if (reaped) log.info('jobs reaped from stalled processing', { reaped, abandoned: abandoned.length })
        // Похороненным — финализатор: попытки у них кончились, и никакой хендлер уже не
        // проснётся, чтобы закрыть видимое состояние фичи. Задачи независимы (каждая про
        // свою сущность), поэтому разом, а не по очереди.
        await Promise.all(abandoned.map(finalize))
        // ...и ДОБОР потерянных похорон. Быстрый путь выше переживает не всё: моргнула база,
        // процесс убили между пометкой 'failed' и вызовом — задача уже не 'processing', и
        // reaper её больше не предложит НИКОГДА. Тогда «в процессе» у фичи остаётся навсегда,
        // то есть ровно тот вечный спиннер, ради которого всё это и делалось.
        const lost = await claimUnfinalizedJobs(finalizedTypes)
        if (lost.length) {
          log.info('jobs awaiting finalization', { count: lost.length })
          await Promise.all(lost.map(finalize))
        }
      }
      // Уборка терминальных — раз в час: таблица очереди не архив, а расти ей без предела
      // некуда (у River на это отдельный cleaner). Идёт ПОСЛЕ финализации намеренно: успевшие
      // похоронить свои задачи строки уже помечены и под удаление попадут законно.
      if (ticks % CLEANUP_EVERY_TICKS === 1) {
        // Типы с финализатором передаём внутрь: у них провал без похорон удалять нельзя, у
        // остальных `finalized_at` пуст всегда — требовать его значило бы не убирать их вовсе.
        const removed = await cleanupTerminalJobs(finalizedTypes)
        if (removed) log.info('terminal jobs cleaned up', { removed })
      }
      // CONCURRENCY раннеров дренят очередь параллельно; каждый берёт задачу, обрабатывает, берёт
      // следующую — пока очередь не опустеет или не выберем BATCH за тик (общий кап, чтобы огромная
      // очередь не крутилась одним тиком бесконечно). Пустая очередь → все раннеры выходят, ждём POLL_MS.
      let processed = 0
      const runner = async (): Promise<void> => {
        while (processed < BATCH) {
          const job = await claimJob()
          if (!job) break
          processed++
          await processOne(job)
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, () => runner()))
    } catch (e) {
      // Ошибка самого цикла (напр. БД недоступна) — не роняем сервер, ждём следующий тик.
      captureError(e, { where: 'jobs.tick' })
    } finally {
      running = false
    }
  }

  setInterval(() => void tick(), POLL_MS)
  log.info('jobs worker started', { pollMs: POLL_MS })
}
