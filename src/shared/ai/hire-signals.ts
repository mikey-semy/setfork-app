import 'server-only'
import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { db, generationCandidates, generationMessages, generations } from '@/shared/db'
import { getRosterAll } from '@/shared/ai/roster'
import { tagMatches } from '@/shared/ai/precedent-filter'

/**
 * СИГНАЛ НАЙМА — темы, по которым у компании нет профильного мастера.
 *
 * Живёт в shared, а не в админке: читают его двое — зал совета (показать «кого не хватает») и
 * петля партнёров (положить в повестку развития), а фича из фичи у нас не импортируется.
 * Пишущая часть найма (черновик профиля моделью, вставка в штат) осталась в админке: она
 * действие человека, а не общий расчёт.
 */

export interface HireSignal {
  tag: string
  n: number
}

/** Матч тега и домена — та же логика, что доменная линза прецедентов (pickPrecedents). */
// Единая доменная линза — та же, что фильтрует прецеденты и раздаёт садовничество.
const covers = tagMatches

/**
 * Сигнал найма: теги кандидатов за 30 дней из генераций, где черновик писал
 * гном-универсал ('*'), НЕ покрытые доменами профильных гномов. Чистая
 * агрегация — без LLM, считается при открытии зала совета.
 */
export async function hireSignals(): Promise<HireSignal[]> {
  const roster = await getRosterAll()
  const generalists = roster.filter((e) => e.domains.includes('*')).map((e) => e.id)
  if (!generalists.length) return []
  const domains = roster.filter((e) => e.enabled && !e.domains.includes('*')).flatMap((e) => e.domains.map((d) => d.toLowerCase()))

  const genIds = db
    .select({ id: generations.id })
    .from(generations)
    .innerJoin(generationMessages, eq(generationMessages.generationId, generations.id))
    .where(and(eq(generationMessages.kind, 'draft'), inArray(generationMessages.who, generalists), gte(generations.createdAt, sql`now() - interval '30 days'`)))
  const rows = await db
    .select({ tag: sql<string>`unnest(${generationCandidates.tags})`, n: sql<number>`count(*)::int` })
    .from(generationCandidates)
    .where(inArray(generationCandidates.generationId, genIds))
    .groupBy(sql`1`)
    .orderBy(sql`2 desc`)
    .limit(30)

  return rows
    .map((r) => ({ tag: r.tag.toLowerCase().trim(), n: r.n }))
    .filter((r) => r.tag && r.n >= 2 && !domains.some((d) => covers(r.tag, d)))
    .slice(0, 5)
}

