import 'server-only'
import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { db, discussions, issues, stars, suggestions, templates } from '@/shared/db'

/**
 * Здоровье списков владельца (HQ §11, Obsidian-вектор → «не граф ради линий, а
 * панель, которая подсказывает, где болит»): светофор по каждому списку.
 * red — требует внимания (открытые предложения/issues), yellow — свежая
 * активность за 7 дней (звёзды/форки/обсуждения), green — спокойно.
 * Чистая агрегация по уже существующим таблицам, ноль новых данных.
 */

export type ListHealthStatus = 'red' | 'yellow' | 'green'

export interface ListHealth {
  id: string
  slug: string
  title: unknown
  status: ListHealthStatus
  openSuggestions: number
  openIssues: number
  freshStars: number
  freshForks: number
  freshDiscussions: number
  updatedAt: Date
}

const WEEK = sql`now() - interval '7 days'`

export async function listsHealth(ownerId: string): Promise<ListHealth[]> {
  const mine = await db
    .select({ id: templates.id, slug: templates.slug, title: templates.title, updatedAt: templates.updatedAt })
    .from(templates)
    .where(eq(templates.ownerId, ownerId))
  if (!mine.length) return []
  const ids = mine.map((t) => t.id)

  const count = (rows: { tplId: string | null; n: number }[]) => {
    const m = new Map<string, number>()
    for (const r of rows) if (r.tplId) m.set(r.tplId, r.n)
    return m
  }

  const [sugg, iss, starRows, forkRows, discRows] = await Promise.all([
    db
      .select({ tplId: suggestions.templateId, n: sql<number>`count(*)::int` })
      .from(suggestions)
      .where(and(inArray(suggestions.templateId, ids), eq(suggestions.status, 'open')))
      .groupBy(suggestions.templateId),
    db
      .select({ tplId: issues.templateId, n: sql<number>`count(*)::int` })
      .from(issues)
      .where(and(inArray(issues.templateId, ids), eq(issues.status, 'open')))
      .groupBy(issues.templateId),
    db
      .select({ tplId: stars.templateId, n: sql<number>`count(*)::int` })
      .from(stars)
      .where(and(inArray(stars.templateId, ids), gte(stars.createdAt, WEEK)))
      .groupBy(stars.templateId),
    db
      .select({ tplId: templates.forkedFromId, n: sql<number>`count(*)::int` })
      .from(templates)
      .where(and(inArray(templates.forkedFromId, ids), gte(templates.createdAt, WEEK)))
      .groupBy(templates.forkedFromId),
    db
      .select({ tplId: discussions.templateId, n: sql<number>`count(*)::int` })
      .from(discussions)
      .where(and(inArray(discussions.templateId, ids), gte(discussions.createdAt, WEEK)))
      .groupBy(discussions.templateId),
  ])
  const s = count(sugg)
  const i = count(iss)
  const st = count(starRows)
  const f = count(forkRows)
  const d = count(discRows)

  const rank: Record<ListHealthStatus, number> = { red: 0, yellow: 1, green: 2 }
  return mine
    .map((t) => {
      const openSuggestions = s.get(t.id) ?? 0
      const openIssues = i.get(t.id) ?? 0
      const freshStars = st.get(t.id) ?? 0
      const freshForks = f.get(t.id) ?? 0
      const freshDiscussions = d.get(t.id) ?? 0
      const status: ListHealthStatus =
        openSuggestions + openIssues > 0 ? 'red' : freshStars + freshForks + freshDiscussions > 0 ? 'yellow' : 'green'
      return { ...t, status, openSuggestions, openIssues, freshStars, freshForks, freshDiscussions }
    })
    .sort((a, b) => rank[a.status] - rank[b.status] || b.updatedAt.getTime() - a.updatedAt.getTime())
}
