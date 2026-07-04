import 'server-only'
import { captureError, log } from '@/shared/observability'
import { claimJob, completeJob, failJob, type Job } from './queue'
import { runEmailJob, runGenerateJob, runPushJob, runReindexJob } from './handlers'

// Реестр обработчиков по типу задачи.
const HANDLERS: Record<string, (payload: unknown) => Promise<void>> = {
  email: runEmailJob,
  generate: runGenerateJob,
  reindex: runReindexJob,
  push: runPushJob,
}

const POLL_MS = 3000
const BATCH = 50 // максимум задач за тик — чтобы не голодать event loop

let started = false

async function processOne(job: Job): Promise<void> {
  const handler = HANDLERS[job.type]
  try {
    if (!handler) throw new Error(`no handler for job type: ${job.type}`)
    await handler(job.payload)
    await completeJob(job.id)
  } catch (e) {
    captureError(e, { where: 'jobs.handle', jobType: job.type, jobId: job.id })
    await failJob(job, e instanceof Error ? e.message : String(e))
  }
}

/**
 * Запускает фоновый воркер очереди (idempotent — второй вызов игнорируется).
 * Вызывается из instrumentation.register() на старте Node-сервера. Между инстансами
 * задачи не дублируются за счёт FOR UPDATE SKIP LOCKED в claimJob.
 */
export function startWorker(): void {
  if (started) return
  started = true

  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
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
