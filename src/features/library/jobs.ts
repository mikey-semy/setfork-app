import 'server-only'
import { reindexList } from './reindex'

export interface ReindexJobPayload {
  templateId: string
}

/** Переиндексация одного списка (эмбеддинг). Ошибка embedding-API → ретрай с backoff. */
export async function runReindexJob(payload: unknown): Promise<void> {
  const p = payload as ReindexJobPayload
  await reindexList(p.templateId)
}
