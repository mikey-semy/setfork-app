import 'server-only'
import { and, gte, ne, sql } from 'drizzle-orm'
import { aiUsage, db } from '@/shared/db'

// Здоровье моделей по журналу ai_usage (outcome + duration_ms) — сырьё для
// щитка надёжности в админке и АВТОРОТАЦИИ пула совета: модель с проседающим
// success-rate за последние сутки временно выпадает из ротации. Окно скользящее,
// поэтому «помилование» автоматическое: фейлы состарились — модель вернулась.

export interface ModelHealth {
  model: string
  calls: number
  okRate: number // 0..1
  p95Ms: number
}

export const QUARANTINE_WINDOW_MS = 24 * 3_600_000
export const QUARANTINE_MIN_CALLS = 8 // меньше — не статистика, а шум
export const QUARANTINE_OK_THRESHOLD = 0.9
const CACHE_TTL_MS = 5 * 60_000

/** Карантин: достаточно вызовов и успех ниже порога. Чистая — юнит-тестируется. */
export function isQuarantined(h: ModelHealth): boolean {
  return h.calls >= QUARANTINE_MIN_CALLS && h.okRate < QUARANTINE_OK_THRESHOLD
}

/** ':online'-суффикс в журнале — вариант той же модели: карантиним по базовому id. */
export function baseModelId(m: string): string {
  return m.replace(/:online$/, '')
}

/** Фильтр пула по карантину; выпали ВСЕ — возвращаем исходный (совет важнее кары). */
export function filterByQuarantine(models: string[], quarantined: ReadonlySet<string>): string[] {
  const healthy = models.filter((m) => !quarantined.has(baseModelId(m)))
  return healthy.length ? healthy : models
}

/** Агрегат здоровья по моделям за окно (эмбеддинги не в счёт — там нет outcome-рисков). */
export async function modelHealth(windowMs: number): Promise<ModelHealth[]> {
  const since = new Date(Date.now() - windowMs)
  const rows = await db
    .select({
      model: aiUsage.model,
      calls: sql<number>`count(*)::int`,
      ok: sql<number>`(count(*) filter (where ${aiUsage.outcome} = 'ok'))::int`,
      p95: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${aiUsage.durationMs}) filter (where ${aiUsage.durationMs} > 0), 0)::int`,
    })
    .from(aiUsage)
    .where(and(gte(aiUsage.createdAt, since), ne(aiUsage.feature, 'embed')))
    .groupBy(aiUsage.model)
  return rows.map((r) => ({
    model: r.model,
    calls: r.calls,
    okRate: r.calls ? r.ok / r.calls : 1,
    p95Ms: r.p95,
  }))
}

let cache: { at: number; set: Set<string> } | null = null

/** Кешированный набор моделей в карантине (TTL 5 мин — не дёргать БД на каждый совет). */
export async function quarantinedModels(): Promise<ReadonlySet<string>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.set
  try {
    const health = await modelHealth(QUARANTINE_WINDOW_MS)
    const set = new Set(health.filter(isQuarantined).map((h) => baseModelId(h.model)))
    cache = { at: Date.now(), set }
    return set
  } catch {
    return cache?.set ?? new Set() // здоровье недоступно — не мешаем генерации
  }
}

export function clearHealthCache(): void {
  cache = null
}
