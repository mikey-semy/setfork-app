import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, jobs } from '@/shared/db'
import { enqueueJob } from '@/shared/jobs/queue'
import { reindexList } from './reindex'

export interface ReindexJobPayload {
  templateId: string
}

/** Переиндексация одного списка (эмбеддинг). Ошибка embedding-API → ретрай с backoff. */
export async function runReindexJob(payload: unknown): Promise<void> {
  const p = payload as ReindexJobPayload
  await reindexList(p.templateId)
}

/**
 * Поставить точечную переиндексацию списка в очередь — вызывается из экшенов после
 * создания/новой версии списка. Сам эмбеддинг делает воркер (durable + ретраи при
 * флапах embedding-API). Best-effort: сбой постановки не должен ронять действие.
 */
export async function enqueueReindex(listId: string): Promise<void> {
  try {
    // Дедуп: одна невыполненная reindex-джоба на список уже переиндексирует его
    // последнюю версию. Без этого каждая правка/merge плодила лишний embedding-вызов.
    const [dup] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.type, 'reindex'), inArray(jobs.status, ['pending', 'processing']), sql`${jobs.payload}->>'templateId' = ${listId}`))
      .limit(1)
    if (dup) return
    await enqueueJob('reindex', { templateId: listId })
  } catch {
    /* индексация — не критичный путь */
  }
}
