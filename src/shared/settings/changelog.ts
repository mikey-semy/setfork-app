import 'server-only'
import { inArray } from 'drizzle-orm'
import { appSettings, db } from '@/shared/db'

/**
 * Настройки публичного changelog — как у остальных подсистем, из админки.
 *
 * Выключен по умолчанию: подтягивать чужой репозиторий и показывать его историю
 * на витрине — решение, а не поведение по умолчанию.
 */
export const CHANGELOG_KEYS = {
  enabled: 'changelog.enabled', // показывать блок и страницу
  repo: 'changelog.repo', // 'owner/name' на GitHub
  source: 'changelog.source', // 'releases' | 'merged'
  everyHours: 'changelog.every_hours', // как часто обновлять
  translate: 'changelog.translate', // добирать второй язык через ИИ
  token: 'changelog.token', // PAT для ПРИВАТНОГО репозитория (публичный читается анонимно)
} as const

export type ChangelogSource = 'releases' | 'merged'

export interface ChangelogSettings {
  enabled: boolean
  repo: string
  source: ChangelogSource
  everyHours: number
  translate: boolean
  /** Токен ЗАДАН — сам он наружу не отдаётся (в форму уходит только этот факт). */
  hasToken: boolean
}

const DEFAULTS: ChangelogSettings = {
  enabled: false,
  repo: '',
  source: 'merged', // слитые предложения — то, что реально меняет продукт
  everyHours: 6,
  translate: true,
  hasToken: false,
}

const TTL_MS = 5_000
let cache: { value: ChangelogSettings; ts: number } | null = null
export function clearChangelogCache(): void {
  cache = null
}

/**
 * Сам токен — ОТДЕЛЬНОЙ функцией и только на сервере.
 *
 * В `getChangelogSettings` его нет намеренно: эти настройки уходят в форму
 * админки, то есть на клиент, и секрету там делать нечего.
 */
export async function getChangelogToken(): Promise<string> {
  try {
    const [row] = await db.select().from(appSettings).where(inArray(appSettings.key, [CHANGELOG_KEYS.token]))
    return row?.value ?? ''
  } catch {
    return ''
  }
}

export async function getChangelogSettings(): Promise<ChangelogSettings> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.value
  let m: Record<string, string> = {}
  try {
    const rows = await db.select().from(appSettings).where(inArray(appSettings.key, Object.values(CHANGELOG_KEYS)))
    m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  } catch {
    // БД недоступна — дефолты (fail-safe: выключено)
  }
  const hours = Number(m[CHANGELOG_KEYS.everyHours])
  const value: ChangelogSettings = {
    enabled: m[CHANGELOG_KEYS.enabled] === 'true',
    // Строгая форма owner/name: значение уходит в URL к api.github.com, и
    // произвольная строка оттуда сделала бы запрос куда угодно.
    repo: /^[\w.-]+\/[\w.-]+$/.test(m[CHANGELOG_KEYS.repo] ?? '') ? m[CHANGELOG_KEYS.repo] : DEFAULTS.repo,
    source: m[CHANGELOG_KEYS.source] === 'releases' ? 'releases' : 'merged',
    everyHours: Number.isFinite(hours) && hours >= 1 && hours <= 24 * 7 ? Math.round(hours) : DEFAULTS.everyHours,
    translate: m[CHANGELOG_KEYS.translate] !== 'false',
    hasToken: !!m[CHANGELOG_KEYS.token],
  }
  cache = { value, ts: Date.now() }
  return value
}
