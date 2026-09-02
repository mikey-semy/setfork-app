import 'server-only'
import { and, desc, eq, sql, type SQL } from 'drizzle-orm'
import { db, issueComments, issues, templates, users, publiclyVisible } from '@/shared/db'
import { feedWindow } from '@/shared/lib/paging'
import { issueKeywordCond } from './keyword'
import type { LocaleText } from '@/shared/i18n'

export type IssueStateFilter = 'open' | 'closed' | 'all'

export interface IssueSearchRow {
  id: string
  ownerHandle: string
  slug: string
  templateTitle: LocaleText
  number: number
  title: string
  status: 'open' | 'closed'
  commentsCount: number
  updatedAt: Date
}

// Issue виден в глобальном поиске только если его список публичный и опубликован.
function issuesWhere(q?: string, state: IssueStateFilter = 'open'): SQL {
  const conds: SQL[] = [
    publiclyVisible(),
  ]
  if (state !== 'all') conds.push(eq(issues.status, state))
  const term = q?.trim()
  // Где именно ищем слова — в одном месте на все поиски задач (см. ./keyword).
  if (term) conds.push(issueKeywordCond(term))
  return and(...conds)!
}

/**
 * Число задач под запрос — ДЛЯ ТОГО ЖЕ ОТБОРА, что и выдача.
 *
 * ⚠️ Бейдж считался по всем статусам, а показывались открытые: на запрос, где одна
 * задача открыта и семь закрыто, переключатель обещал восемь, а список показывал одну.
 * Расхождение тихое — обе цифры по отдельности верны.
 */
export async function countIssues(q?: string, state: IssueStateFilter = 'all'): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(issues)
    .innerJoin(templates, eq(issues.templateId, templates.id))
    .where(issuesWhere(q, state))
  return row?.n ?? 0
}

const commentsCountExpr = sql<number>`(select count(*)::int from ${issueComments} where ${issueComments.issueId} = ${issues.id})`

/**
 * Глобальный кросс-списочный поиск задач: СТРАНИЦА И ЕЁ ОБЪЁМ ВМЕСТЕ.
 *
 * Объём возвращается отсюда, а не считается отдельным вызовом на экране, ровно по той же
 * причине, что и у списков (`getSearchPage`): число страниц обязано считаться по ТОМУ ЖЕ
 * отбору, который показан. Разъедься они — листалка нарисует страницы, за которыми
 * ничего нет, и ошибка будет тихой: обе цифры по отдельности верны.
 */
export async function searchIssues({
  q,
  state = 'open',
  window,
}: {
  q?: string
  state?: IssueStateFilter
  /** Окно страницы. Битый предел драйвер выбрасывает молча — см. `feedWindow`. */
  window: { limit: number; offset?: number }
}): Promise<{ items: IssueSearchRow[]; total: number }> {
  const { limit, offset } = feedWindow(window)
  const where = issuesWhere(q, state)
  const rows = await db
    .select({
      id: issues.id,
      ownerHandle: users.handle,
      slug: templates.slug,
      templateTitle: templates.title,
      number: issues.number,
      title: issues.title,
      status: issues.status,
      commentsCount: commentsCountExpr,
      updatedAt: issues.updatedAt,
    })
    .from(issues)
    .innerJoin(templates, eq(issues.templateId, templates.id))
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(where)
    .orderBy(desc(issues.updatedAt))
    .limit(limit)
    .offset(offset)
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(issues)
    .innerJoin(templates, eq(issues.templateId, templates.id))
    .where(where)
  return { items: rows as IssueSearchRow[], total: count?.n ?? 0 }
}
