import 'server-only'
import type { SearchIndex } from '@/core'
import { purgeStaleEmbeddings, reindexList } from '@/features/library/reindex'

// Адаптер порта SearchIndex — обслуживание индекса эмбеддингов (pgvector).
// Реализация уже изолирована в library/reindex.ts; здесь формализуем контракт под Rust.
export const searchIndex: SearchIndex = {
  reindex: (listId) => reindexList(listId),
  purgeStale: (activeRefIds) => purgeStaleEmbeddings(activeRefIds),
}
