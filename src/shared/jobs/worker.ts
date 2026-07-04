import 'server-only'
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
      console.warn('[jobs] tick error:', e instanceof Error ? e.message : e)
    } finally {
      running = false
    }
  }

  setInterval(() => void tick(), POLL_MS)
  console.log('[jobs] worker started')
}
