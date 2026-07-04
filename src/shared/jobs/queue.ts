import 'server-only'
import { eq, sql } from 'drizzle-orm'
import { db, jobs, type JobType } from '@/shared/db'
import { backoffMs } from './backoff'

export interface Job {
  id: string
  type: string
  payload: unknown
  attempts: number
  maxAttempts: number
}

/** Поставить задачу в очередь. Это дешёвый insert — можно звать прямо из request-пути. */
export async function enqueueJob(
  type: JobType,
  payload: Record<string, unknown>,
  opts?: { maxAttempts?: number; delayMs?: number },
): Promise<void> {
  await db.insert(jobs).values({
    type,
    payload,
    maxAttempts: opts?.maxAttempts ?? 5,
    runAt: opts?.delayMs ? new Date(Date.now() + opts.delayMs) : new Date(),
  })
}

/**
 * Атомарно захватывает одну готовую задачу и переводит в processing.
 * `FOR UPDATE SKIP LOCKED` — параллельные воркеры/инстансы не берут одну задачу дважды.
 */
export async function claimJob(): Promise<Job | null> {
  const res = await db.execute(sql`
    UPDATE jobs SET status = 'processing', attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'pending' AND run_at <= now()
      ORDER BY run_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, type, payload, attempts, max_attempts
  `)
  const r = (res as { rows?: Record<string, unknown>[] }).rows?.[0]
  if (!r) return null
  return {
    id: String(r.id),
    type: String(r.type),
    payload: r.payload,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
  }
}

/** Успех — задача выполнена. */
export async function completeJob(id: string): Promise<void> {
  await db.update(jobs).set({ status: 'done', updatedAt: new Date() }).where(eq(jobs.id, id))
}

/** Ошибка — ретрай с backoff, либо `failed` после исчерпания попыток (attempts уже инкрементнут в claim). */
export async function failJob(job: Job, error: string): Promise<void> {
  const permanent = job.attempts >= job.maxAttempts
  await db
    .update(jobs)
    .set({
      status: permanent ? 'failed' : 'pending',
      runAt: permanent ? undefined : new Date(Date.now() + backoffMs(job.attempts)),
      lastError: error.slice(0, 1000),
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, job.id))
}
