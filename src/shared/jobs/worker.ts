import 'server-only'
import { captureError, log } from '@/shared/observability'
import { JOB_TYPES, type JobType } from '@/shared/db'
import { claimJob, completeJob, failJob, reapStalledJobs, type Job } from './queue'
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

  /** Похороны задачи — фича закрывает своё «в процессе». Падение финализатора не должно
   *  ронять цикл: он и так вызывается по факту чужой аварии. */
  const finalize = async (job: Job): Promise<void> => {
    const fin = finalizers[job.type]
    if (!fin) return
    try {
      await fin(job.payload, job)
    } catch (e) {
      captureError(e, { where: 'jobs.finalize', jobType: job.type, jobId: job.id })
    }
  }

  const processOne = async (job: Job): Promise<void> => {
    // Проверку на отсутствие оставляем и здесь: в базе может лежать тип от старой версии кода.
    const handler = handlers[job.type]
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
        // проснётся, чтобы закрыть видимое состояние фичи.
        for (const job of abandoned) await finalize(job)
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
