import 'server-only'
import { and, gte, ne, sql } from 'drizzle-orm'
import { aiUsage, db } from '@/shared/db'
import { asDate } from '@/shared/db/raw'
import { envNumber } from '@/shared/env'
import { baseModelId, isQuarantined } from './health'

/**
 * НАШ рейтинг моделей — из журнала ai_usage, а не из чужих лидербордов.
 *
 * Зачем: выбирая модель в админке, невозможно было понять, чем она обернётся ИМЕННО У НАС —
 * сколько раз мы её звали, как часто она отвечала мусором, сколько стоил один вызов. Прайс-лист
 * этого не говорит: дешёвая модель, которая в трети случаев отдаёт невалидный JSON, обходится
 * дороже дорогой (бенч 2026-07-18). Поэтому рядом с ценой каталога всегда стоит цена и успех
 * НАШЕГО вызова.
 *
 * Ключ агрегата — БАЗОВЫЙ id (health.baseModelId): `:online` — это та же модель с веб-надбавкой,
 * и разводить их по разным строкам значило бы дробить и без того небольшую статистику. Надбавка
 * при этом видна: она сидит в avgCostUsd вызовов с веб-поиском.
 */

export interface ModelUsageStat {
  /** Базовый id без ':online'. */
  model: string
  calls: number
  /** 0..1 — доля вызовов с outcome='ok' (мусорный JSON и таймаут считаются провалом). */
  okRate: number
  /** 95-й перцентиль длительности успешных вызовов, мс. */
  p95Ms: number
  /** Средняя цена ОДНОГО нашего вызова, USD (включая веб-надбавку, если она была). */
  avgCostUsd: number
  /** Суммарный расход за окно, USD. */
  costUsd: number
  lastAt: Date | null
  /** Модель в карантине: успех ниже порога при достаточной выборке (health.ts). */
  quarantined: boolean
}

/** Окно рейтинга. Настраивается стендом: у полигона и у прода разный темп вызовов, и
 *  «30» — это дефолт, а не закон. envNumber, а не Number(): мусор даёт дефолт, не NaN. */
export const STATS_WINDOW_DAYS = envNumber('SETFORK_MODEL_STATS_DAYS', 30)

/**
 * Агрегат по всем моделям за окно. Эмбеддинги в счёт идут: у них тоже есть цена и отказы,
 * а селект эмбеддинг-модели — такой же выбор, как и чатовой. Исключается только служебный шум
 * без модели (пустой id).
 */
export async function modelUsageStats(days = STATS_WINDOW_DAYS): Promise<Map<string, ModelUsageStat>> {
  const since = sql`now() - ${`${days} days`}::interval`
  // Базовый id считаем в SQL: иначе ':online' и голая модель дали бы две строки, которые
  // пришлось бы сливать в JS — с потерей percentile_cont (его по частям не сложить).
  const base = sql<string>`regexp_replace(${aiUsage.model}, ':online$', '')`
  const rows = await db
    .select({
      model: base,
      calls: sql<number>`count(*)::int`,
      ok: sql<number>`(count(*) filter (where ${aiUsage.outcome} = 'ok'))::int`,
      p95: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${aiUsage.durationMs}) filter (where ${aiUsage.durationMs} > 0 and ${aiUsage.outcome} = 'ok'), 0)::int`,
      cost: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float8`,
      lastAt: sql<Date | null>`max(${aiUsage.createdAt})`,
    })
    .from(aiUsage)
    .where(and(gte(aiUsage.createdAt, since), ne(aiUsage.model, '')))
    .groupBy(base)

  const out = new Map<string, ModelUsageStat>()
  for (const r of rows) {
    const okRate = r.calls ? r.ok / r.calls : 1
    out.set(r.model, {
      model: r.model,
      calls: r.calls,
      okRate,
      p95Ms: r.p95,
      avgCostUsd: r.calls ? r.cost / r.calls : 0,
      costUsd: r.cost,
      // Дата из сырого max(...): тип обещан вручную, наружу отдаём настоящий Date.
      lastAt: asDate(r.lastAt),
      // Тот же порог, по которому совет выводит модель из ротации: щиток и авторотация
      // обязаны говорить одно и то же, иначе «почему её не зовут» неотвечаемо.
      quarantined: isQuarantined({ model: r.model, calls: r.calls, okRate, p95Ms: r.p95 }),
    })
  }
  return out
}

/** Статистика одной модели (по базовому id) — для карточки специалиста. */
export function statOf(stats: Map<string, ModelUsageStat>, model: string): ModelUsageStat | undefined {
  return model ? stats.get(baseModelId(model)) : undefined
}
