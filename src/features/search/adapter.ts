import 'server-only'
import type { SearchIndex } from '@/core'
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
    await enqueueJob('reindex', { templateId: listId })
  } catch {
    /* индексация — не критичный путь */
  }
}
