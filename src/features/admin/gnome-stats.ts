import 'server-only'
import { and, arrayOverlaps, desc, eq, gte, sql } from 'drizzle-orm'
import { aiUsage, db, generationMessages, generations, templates, publiclyVisible } from '@/shared/db'

/**
 * KPI гнома — этап (а) профразвития (HQ research/2026-07-21-gnome-workshop.md, раздел 4).
 * Атрибуция участия НЕ требует новой таблицы: kind='draft' в generation_messages
 * пишется ровно при вызове эксперта (council.ts), who = id гнома. Отсюда:
 * участие в витках/генерациях, принятые списки (generations.chosen_template_id),
 * последние выходы. Метрики личной модели — из журнала ai_usage.
 */

export interface GnomeRecentRow {
  query: string
  createdAt: Date
  accepted: boolean
}

export interface GnomeKpi {
  /** Витков совета с его черновиком (виток = генерация+attempt). */
  rounds30d: number
  roundsTotal: number
  /** Генераций с его участием / из них пользователь принял список. */
  gens: number
  accepted: number
  lastSeenAt: Date | null
  /** База знаний: публичных активных списков с тегами его доменов (точное пересечение массивов). */
  knowledge: number
  /** Личная модель (если задана): вызовы/успех/скорость за 7 дней. */
  model: { calls: number; okRate: number; avgMs: number } | null
  recent: GnomeRecentRow[]
}

const DRAFT = 'draft'

export async function gnomeKpi(id: string, domains: string[], model: string): Promise<GnomeKpi> {
  const participated = sql`exists (select 1 from ${generationMessages} m
    where m.generation_id = ${generations.id} and m.who = ${id} and m.kind = ${DRAFT})`

  const [rounds, gensRow, recent, knowledgeRow, modelRow] = await Promise.all([
    db
      .select({
        total: sql<number>`count(distinct (${generationMessages.generationId}, ${generationMessages.attempt}))::int`,
        recent: sql<number>`count(distinct (${generationMessages.generationId}, ${generationMessages.attempt})) filter (where ${generationMessages.createdAt} >= now() - interval '30 days')::int`,
        last: sql<Date | null>`max(${generationMessages.createdAt})`,
      })
      .from(generationMessages)
      .where(and(eq(generationMessages.who, id), eq(generationMessages.kind, DRAFT))),
    db
      .select({
        gens: sql<number>`count(*)::int`,
        accepted: sql<number>`count(*) filter (where ${generations.chosenTemplateId} is not null)::int`,
      })
      .from(generations)
      .where(participated),
    db
      .select({ query: generations.query, createdAt: generations.createdAt, accepted: sql<boolean>`${generations.chosenTemplateId} is not null` })
      .from(generations)
      .where(participated)
      .orderBy(desc(generations.createdAt))
      .limit(8),
    // '*' — универсал: его «база» = весь публичный корпус. Иначе точное пересечение
    // тегов с доменами (substring-матч живёт в pickPrecedents на горячем пути —
    // здесь достаточно индикатора, а не той же формулы).
    domains.includes('*')
      ? db
          .select({ n: sql<number>`count(*)::int` })
          .from(templates)
          .where(and(publiclyVisible()))
      : db
          .select({ n: sql<number>`count(*)::int` })
          .from(templates)
          .where(
            and(
              publiclyVisible(),
              arrayOverlaps(templates.tags, domains),
            ),
          ),
    model
      ? db
          .select({
            calls: sql<number>`count(*)::int`,
            ok: sql<number>`count(*) filter (where ${aiUsage.outcome} = 'ok')::int`,
            avgMs: sql<number>`coalesce(avg(${aiUsage.durationMs}) filter (where ${aiUsage.outcome} = 'ok'), 0)::int`,
          })
          .from(aiUsage)
          .where(and(eq(aiUsage.model, model), gte(aiUsage.createdAt, sql`now() - interval '7 days'`)))
      : Promise.resolve([]),
  ])

  const r = rounds[0]
  const g = gensRow[0]
  const m = modelRow[0]
  return {
    rounds30d: r?.recent ?? 0,
    roundsTotal: r?.total ?? 0,
    gens: g?.gens ?? 0,
    accepted: g?.accepted ?? 0,
    lastSeenAt: r?.last ?? null,
    knowledge: knowledgeRow[0]?.n ?? 0,
    model: m && m.calls > 0 ? { calls: m.calls, okRate: m.ok / m.calls, avgMs: m.avgMs } : null,
    recent,
  }
}
