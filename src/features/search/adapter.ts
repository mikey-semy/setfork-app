import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { SearchIndex } from '@/core'
import { db, jobs } from '@/shared/db'
import { enqueueJob } from '@/shared/jobs/queue'
import { purgeStaleEmbeddings, reindexList } from '@/features/library/reindex'

// Адаптер порта SearchIndex — обслуживание индекса эмбеддингов (pgvector).
// Реализация уже изолирована в library/reindex.ts; здесь формализуем контракт под Rust.
export const searchIndex: SearchIndex = {
  reindex: (listId) => reindexList(listId),
  purgeStale: (activeRefIds) => purgeStaleEmbeddings(activeRefIds),
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
