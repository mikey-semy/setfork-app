import 'server-only'
import { inArray } from 'drizzle-orm'
import { appSettings, db } from '@/shared/db'

// Настройки link-checker'а («живые списки», Ж1) — всё из админки (appSettings),
// как у монетизации: OFF по умолчанию, включается когда решим катить.

export const LINKCHECK_KEYS = {
  enabled: 'linkcheck.enabled', // главный тумблер свипа
  everyHours: 'linkcheck.every_hours', // период перепланирования
  batchProbes: 'linkcheck.batch_probes', // проб на одну джобу (чанк < reap-порога 30 мин)
  dailyCap: 'linkcheck.daily_cap', // суточный потолок проб (вежливость + предсказуемая нагрузка)
  perHostPerMin: 'linkcheck.per_host_per_min', // politeness: проб на один хост в минуту
  concurrency: 'linkcheck.concurrency', // одновременных проб внутри батча
  brokenFails: 'linkcheck.broken_fails', // сколько свипов-подтверждений до verdict broken
} as const

export interface LinkcheckSettings {
  enabled: boolean
  everyHours: number
  batchProbes: number
  dailyCap: number
  perHostPerMin: number
  concurrency: number
  brokenFails: number
}

const DEFAULTS: LinkcheckSettings = {
  enabled: false,
  everyHours: 48, // тот же ритм, что свип садовника
  batchProbes: 200, // ~2-13 мин на джобу — заведомо меньше reap-порога
  dailyCap: 2000, // весь корпус (~3-4k URL) перепроверяется за ~2 суток
  perHostPerMin: 6,
  concurrency: 4,
  brokenFails: 3, // 3 разных свипа ≈ 6 суток до окончательного «битая»
}

const TTL_MS = 5_000
let cache: { value: LinkcheckSettings; ts: number } | null = null
export function clearLinkcheckCache(): void {
  cache = null
}

export async function getLinkcheckSettings(): Promise<LinkcheckSettings> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.value
  const keys = Object.values(LINKCHECK_KEYS)
  let m: Record<string, string> = {}
  try {
    const rows = await db.select().from(appSettings).where(inArray(appSettings.key, keys))
    m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  } catch {
    // БД недоступна — работаем на дефолтах (fail-safe: enabled=false)
  }
  const num = (key: string, fallback: number, min: number, max: number) => {
    const n = Number(m[key])
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback
  }
  const value: LinkcheckSettings = {
    enabled: m[LINKCHECK_KEYS.enabled] === 'true',
    everyHours: num(LINKCHECK_KEYS.everyHours, DEFAULTS.everyHours, 1, 24 * 14),
    batchProbes: num(LINKCHECK_KEYS.batchProbes, DEFAULTS.batchProbes, 10, 1000),
    dailyCap: num(LINKCHECK_KEYS.dailyCap, DEFAULTS.dailyCap, 50, 50_000),
    perHostPerMin: num(LINKCHECK_KEYS.perHostPerMin, DEFAULTS.perHostPerMin, 1, 60),
    concurrency: num(LINKCHECK_KEYS.concurrency, DEFAULTS.concurrency, 1, 16),
    brokenFails: num(LINKCHECK_KEYS.brokenFails, DEFAULTS.brokenFails, 1, 10),
  }
  cache = { value, ts: Date.now() }
  return value
}
