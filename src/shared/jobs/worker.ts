import 'server-only'
import { captureError, log } from '@/shared/observability'
import { claimJob, completeJob, failJob, reapStalledJobs, type Job } from './queue'

/** Обработчик задачи. Второй аргумент — сама джоба (attempts/maxAttempts)
 *  для обработчиков, которым важен номер попытки (moderate: fail-open на последней). */
export type JobHandler = (payload: unknown, job: Job) => Promise<void>

const POLL_MS = 3000
const BATCH = 50 // максимум задач за тик — чтобы не голодать event loop
// Сколько задач обрабатываем ОДНОВРЕМЕННО. Генерация — это ОЖИДАНИЕ сети (совет ~60с ждёт
// OpenRouter), а не работа CPU: один процесс держит десятки задач «в полёте» почти даром, пока они
// ждут ответа. Потолок НЕ в нашей инфраструктуре — замерено (research/2026-07-17-capacity-and-cost):
// пул БД держит 200 одновременных задач с 0 ошибок (коннект берётся на миллисекунды, не на время
// вызова модели), а у OpenRouter лимита запросов нет (rate_limit.requests = -1). Единственное, что
// растёт с одновременностью — скорость траты денег, и её ограничивают дневной кап + пол баланса
// (shared/quota). Поэтому число ≈ «сколько советов в минуту хотим»: совет ~60с, значит
// одновременность = пропускная способность в минуту. 25 = ~25 советов/мин; поднимай env'ом под
// нагрузку (100 = 100/мин, проверено по БД). Дефолт 25, а не 100 — до живого нагрузочного теста.
// 100: замер стены (research/2026-07-17-capacity-and-cost) — процесс/IP держит ~5-10K одновременных
// сокетов до ECONNRESET. Совет держит сокет ~60с, так что 100 в полёте — в 50-100× НИЖЕ стены, с
// огромным запасом; это ~100 советов/мин с инстанса. Выше — env'ом; за ~5K уже ближе к TCP-стене.
const CONCURRENCY = Math.max(1, Number(process.env.SETFORK_JOB_CONCURRENCY) || 100)

let started = false

/**
 * Запускает фоновый воркер очереди (idempotent — второй вызов игнорируется).
 * Реестр обработчиков по типу задачи передаёт composition root
 * (instrumentation.ts) — shared/jobs про фичи не знает. Вызывается из
 * instrumentation.register() на старте Node-сервера. Между инстансами
 * задачи не дублируются за счёт FOR UPDATE SKIP LOCKED в claimJob.
 */
export function startWorker(handlers: Record<string, JobHandler>): void {
  if (started) return
  started = true

  const processOne = async (job: Job): Promise<void> => {
    const handler = handlers[job.type]
    try {
      if (!handler) throw new Error(`no handler for job type: ${job.type}`)
      await handler(job.payload, job)
      await completeJob(job.id)
    } catch (e) {
      captureError(e, { where: 'jobs.handle', jobType: job.type, jobId: job.id })
      await failJob(job, e instanceof Error ? e.message : String(e))
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
        const reaped = await reapStalledJobs()
        if (reaped) log.info('jobs reaped from stalled processing', { reaped })
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
