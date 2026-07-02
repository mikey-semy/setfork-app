import 'server-only'
import { eq } from 'drizzle-orm'
import { appSettings, db } from '@/shared/db'

// keyword — ILIKE по словам; semantic — вектор (RAG); hybrid — вектор + добор по словам.
export type SearchMode = 'keyword' | 'semantic' | 'hybrid'
export const SEARCH_MODES: SearchMode[] = ['keyword', 'semantic', 'hybrid']
export const SEARCH_MODE_KEY = 'search.mode'

let cache: SearchMode | null = null
export function clearSearchModeCache(): void {
  cache = null
}

export async function getSearchMode(): Promise<SearchMode> {
  if (cache) return cache
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SEARCH_MODE_KEY)).limit(1)
  const v = row?.value as SearchMode | undefined
  cache = v && SEARCH_MODES.includes(v) ? v : 'hybrid'
  return cache
}
