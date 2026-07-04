import 'server-only'
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { db, issueComments, issues, templates, users } from '@/shared/db'
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
    eq(templates.visibility, 'public'),
    eq(templates.status, 'published'),
    eq(templates.moderation, 'active'),
  ]
  if (state !== 'all') conds.push(eq(issues.status, state))
  const term = q?.trim()
  if (term) {
    const like = `%${term}%`
    // Номер #N ищем только если весь токен — цифры (иначе "12abc" всплывал бы issue #12).
    conds.push(/^\d+$/.test(term) ? or(ilike(issues.title, like), eq(issues.number, Number(term)))! : ilike(issues.title, like))
  }
  return and(...conds)!
}

/** Число issue под запрос (для бейджа scope-переключателя) — по всем статусам. */
export async function countIssues(q?: string, state: IssueStateFilter = 'all'): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(issues)
    .innerJoin(templates, eq(issues.templateId, templates.id))
    .where(issuesWhere(q, state))
  return row?.n ?? 0
}

const commentsCountExpr = sql<number>`(select count(*)::int from ${issueComments} where ${issueComments.issueId} = ${issues.id})`

/** Глобальный кросс-списочный поиск issues. */
export async function searchIssues({
  q,
  state = 'open',
  limit = 30,
}: {
  q?: string
  state?: IssueStateFilter
  limit?: number
}): Promise<IssueSearchRow[]> {
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
    .where(issuesWhere(q, state))
    .orderBy(desc(issues.updatedAt))
    .limit(limit)
  return rows as IssueSearchRow[]
}
