import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, issues, runs, stars, suggestions, templates, users } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'

export interface ImproveItem {
  id: string
  ownerHandle: string
  slug: string
  title: LocaleText
  desc: LocaleText
  starsCount: number
  openIssues: number
  openSuggestions: number
  score: number
  reason: 'starred' | 'ran'
}

/**
 * «Улучшательная лента» (intent-ранкер): списки, которыми пользователь пользуется
 * (отметил звездой ИЛИ прогонял) и которым нужна доводка — есть открытые issues
 * или предложенные правки. Так работает «круговорот улучшения»: возвращаем людей
 * к спискам, которые они ценят, чтобы довести их до безупречности.
 *
 * Ранг = 2·открытых-правок + открытых-issues (правку внести проще всего → выше).
 * Только публично видимые списки; свои — не показываем (это чужой вклад).
 */
export async function getImprovementFeed(userId: string, limit = 20): Promise<ImproveItem[]> {
  const [starred, ran] = await Promise.all([
    db.select({ id: stars.templateId }).from(stars).where(eq(stars.userId, userId)),
    db.select({ id: runs.templateId }).from(runs).where(eq(runs.userId, userId)),
  ])
  const affinity = new Map<string, 'starred' | 'ran'>()
  starred.forEach((r) => affinity.set(r.id, 'starred'))
  ran.forEach((r) => { if (!affinity.has(r.id)) affinity.set(r.id, 'ran') })
  const ids = [...affinity.keys()]
  if (!ids.length) return []

  const [rows, issueCounts, sugCounts] = await Promise.all([
    db
      .select({ id: templates.id, ownerId: templates.ownerId, ownerHandle: users.handle, slug: templates.slug, title: templates.title, desc: templates.desc, starsCount: templates.starsCount })
      .from(templates)
      .innerJoin(users, eq(users.id, templates.ownerId))
      .where(and(inArray(templates.id, ids), eq(templates.visibility, 'public'), eq(templates.status, 'published'), eq(templates.moderation, 'active'))),
    db.select({ id: issues.templateId, c: sql<number>`count(*)::int` }).from(issues).where(and(inArray(issues.templateId, ids), eq(issues.status, 'open'))).groupBy(issues.templateId),
    db.select({ id: suggestions.templateId, c: sql<number>`count(*)::int` }).from(suggestions).where(and(inArray(suggestions.templateId, ids), eq(suggestions.status, 'open'))).groupBy(suggestions.templateId),
  ])
  const iMap = new Map(issueCounts.map((r) => [r.id, r.c]))
  const sMap = new Map(sugCounts.map((r) => [r.id, r.c]))

  return rows
    .filter((r) => r.ownerId !== userId) // свои списки — не «чужой вклад»
    .map((r) => {
      const openIssues = iMap.get(r.id) ?? 0
      const openSuggestions = sMap.get(r.id) ?? 0
      return {
        id: r.id,
        ownerHandle: r.ownerHandle,
        slug: r.slug,
        title: r.title,
        desc: r.desc,
        starsCount: r.starsCount,
        openIssues,
        openSuggestions,
        score: openSuggestions * 2 + openIssues,
        reason: affinity.get(r.id)!,
      }
    })
    .filter((it) => it.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
