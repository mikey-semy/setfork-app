import 'server-only'
import { inArray } from 'drizzle-orm'
import { appSettings, db } from '@/shared/db'

// keyword — ILIKE по словам; semantic — вектор (RAG); hybrid — вектор + добор по словам.
export type SearchMode = 'keyword' | 'semantic' | 'hybrid'
export const SEARCH_MODES: SearchMode[] = ['keyword', 'semantic', 'hybrid']

export const SEARCH_KEYS = {
  mode: 'search.mode',
  minScore: 'search.min_score', // порог косинусной схожести (0..1): ниже — отбрасываем
  limit: 'search.limit', // сколько семантических результатов брать (top-K)
} as const

export interface SearchSettings {
  mode: SearchMode
  minScore: number
  limit: number
}

const DEFAULTS: SearchSettings = { mode: 'hybrid', minScore: 0.3, limit: 20 }

let cache: SearchSettings | null = null
export function clearSearchCache(): void {
  cache = null
}

export async function getSearchSettings(): Promise<SearchSettings> {
  if (cache) return cache
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, Object.values(SEARCH_KEYS)))
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const mode = m[SEARCH_KEYS.mode] as SearchMode | undefined
  const minScore = Number(m[SEARCH_KEYS.minScore])
  const limit = Number(m[SEARCH_KEYS.limit])
  cache = {
    mode: mode && SEARCH_MODES.includes(mode) ? mode : DEFAULTS.mode,
    minScore: Number.isFinite(minScore) ? Math.min(1, Math.max(0, minScore)) : DEFAULTS.minScore,
    limit: Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.round(limit))) : DEFAULTS.limit,
  }
  return cache
}
