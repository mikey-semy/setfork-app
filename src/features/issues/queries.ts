import 'server-only'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db, issueComments, issues, users } from '@/shared/db'
import { avatarSrc } from '@/shared/media'

export type IssueFilter = 'open' | 'closed'

export interface IssueRow {
  id: string
  number: number
  title: string
  status: 'open' | 'closed'
  labels: string[]
  createdAt: Date
  authorHandle: string
  authorAvatarUrl: string | null
  commentCount: number
}

const commentCountSql = sql<number>`(select count(*)::int from ${issueComments} c where c.issue_id = ${issues.id})`

/** Список issue выбранного статуса. */
export async function getIssues(templateId: string, status: IssueFilter): Promise<IssueRow[]> {
  const rows = await db
    .select({
      id: issues.id,
      number: issues.number,
      title: issues.title,
      status: issues.status,
      labels: issues.labels,
      createdAt: issues.createdAt,
      authorHandle: users.handle,
      authorAvatarUrl: users.avatarUrl,
      commentCount: commentCountSql,
    })
    .from(issues)
    .innerJoin(users, eq(issues.authorId, users.id))
    .where(and(eq(issues.templateId, templateId), eq(issues.status, status)))
    .orderBy(desc(issues.number))
  return Promise.all(rows.map(async (r) => ({ ...r, authorAvatarUrl: await avatarSrc(r.authorAvatarUrl, 48) })))
}

export async function getIssueCounts(templateId: string): Promise<{ open: number; closed: number }> {
  const rows = await db
    .select({ status: issues.status, c: sql<number>`count(*)::int` })
    .from(issues)
    .where(eq(issues.templateId, templateId))
    .groupBy(issues.status)
  let open = 0
  let closed = 0
  for (const r of rows) {
    if (r.status === 'open') open = r.c
    else closed = r.c
  }
  return { open, closed }
}

export async function getOpenIssueCount(templateId: string): Promise<number> {
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(issues)
    .where(and(eq(issues.templateId, templateId), eq(issues.status, 'open')))
  return r?.c ?? 0
}

export interface IssueDetail {
  id: string
  number: number
  title: string
  body: string
  status: 'open' | 'closed'
  labels: string[]
  createdAt: Date
  closedAt: Date | null
  authorId: string
  authorHandle: string
  authorAvatarUrl: string | null
}

export interface IssueComment {
  id: string
  body: string
  createdAt: Date
  authorId: string
  authorHandle: string
  authorAvatarUrl: string | null
}

export async function getIssue(templateId: string, number: number): Promise<IssueDetail | null> {
  const [row] = await db
    .select({
      id: issues.id,
      number: issues.number,
      title: issues.title,
      body: issues.body,
      status: issues.status,
      labels: issues.labels,
      createdAt: issues.createdAt,
      closedAt: issues.closedAt,
      authorId: issues.authorId,
      authorHandle: users.handle,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(issues)
    .innerJoin(users, eq(issues.authorId, users.id))
    .where(and(eq(issues.templateId, templateId), eq(issues.number, number)))
    .limit(1)
  if (!row) return null
  return { ...row, authorAvatarUrl: await avatarSrc(row.authorAvatarUrl, 64) }
}

export async function getIssueComments(issueId: string): Promise<IssueComment[]> {
  const rows = await db
    .select({
      id: issueComments.id,
      body: issueComments.body,
      createdAt: issueComments.createdAt,
      authorId: issueComments.authorId,
      authorHandle: users.handle,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(issueComments)
    .innerJoin(users, eq(issueComments.authorId, users.id))
    .where(eq(issueComments.issueId, issueId))
    .orderBy(asc(issueComments.createdAt))
  return Promise.all(rows.map(async (r) => ({ ...r, authorAvatarUrl: await avatarSrc(r.authorAvatarUrl, 48) })))
}
