import 'server-only'
import { captureError, log } from '@/shared/observability'
import { claimJob, completeJob, failJob, reapStalledJobs, type Job } from './queue'

/** Обработчик задачи. Второй аргумент — сама джоба (attempts/maxAttempts)
 *  для обработчиков, которым важен номер попытки (moderate: fail-open на последней). */
export type JobHandler = (payload: unknown, job: Job) => Promise<void>

const POLL_MS = 3000
const BATCH = 50 // максимум задач за тик — чтобы не голодать event loop

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
      for (let i = 0; i < BATCH; i++) {
        const job = await claimJob()
        if (!job) break
        await processOne(job)
      }
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
