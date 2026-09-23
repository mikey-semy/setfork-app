import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, jobs } from '@/shared/db'
import { enqueueJob } from '@/shared/jobs/queue'
import { sweepPendingUploads } from './direct-upload'

/**
 * Подметальщик брошенных прямых загрузок по расписанию — простая самоподдерживающаяся
 * задача, как у link-checker'а (`features/linkcheck`): одна отложенная `uploads_sweep`,
 * обработчик в `finally` ставит следующую. Цепочка зеркал с advisory-локой здесь не
 * нужна: пропущенный или сдвоенный проход ничего не портит — брошенный объект
 * полежит лишний час, а удаление идемпотентно.
 *
 * Раз в час: брошенным считается `pending` старше суток (`PENDING_TTL_MS`), так что
 * объект живёт не дольше ~25 ч; проход — один запрос по индексу (status, created_at),
 * чаще гонять незачем.
 */
export const UPLOADS_SWEEP_MS = 60 * 60 * 1000

/** Одна pending-задача на тип: если уже стоит — ничего не делаем. */
export async function ensureUploadsSweepScheduled(): Promise<void> {
  const [pending] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, 'uploads_sweep'), eq(jobs.status, 'pending')))
    .limit(1)
  if (pending) return
  await enqueueJob('uploads_sweep', {}, { delayMs: UPLOADS_SWEEP_MS, maxAttempts: 1 })
}

/** Обработчик: проход и перепланирование ДАЖЕ при сбое прохода — иначе расписание оборвётся. */
export async function runUploadsSweepJob(): Promise<void> {
  try {
    await sweepPendingUploads()
  } finally {
    await ensureUploadsSweepScheduled()
  }
}
