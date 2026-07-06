import 'server-only'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, issueAssignees, issueComments, issues, listLabels, milestones, users } from '@/shared/db'
import { avatarSrc } from '@/shared/media'
import type { CustomLabel } from './labels'

/** Кастомные метки списка (для пикеров/чипов/менеджера). */
export async function getListLabels(templateId: string): Promise<CustomLabel[]> {
  return db
    .select({ id: listLabels.id, name: listLabels.name, color: listLabels.color })
    .from(listLabels)
    .where(eq(listLabels.templateId, templateId))
    .orderBy(asc(listLabels.name))
}

export type IssueFilter = 'open' | 'closed'
export type IssueSort = 'newest' | 'oldest'

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
  milestoneTitle: string | null
}

const commentCountSql = sql<number>`(select count(*)::int from ${issueComments} c where c.issue_id = ${issues.id})`

/** Список issue: статус + опц. поиск, фильтр по label/вехе, сортировка. */
export async function getIssues(
  templateId: string,
  opts: { status: IssueFilter; q?: string; label?: string; milestone?: string; sort?: IssueSort },
): Promise<IssueRow[]> {
  const conds = [eq(issues.templateId, templateId), eq(issues.status, opts.status)]
  const q = opts.q?.trim()
  if (q) conds.push(sql`${issues.title} ilike ${'%' + q + '%'}`)
  if (opts.label) conds.push(sql`${opts.label} = any(${issues.labels})`)
  if (opts.milestone) conds.push(eq(issues.milestoneId, opts.milestone))
  const order = opts.sort === 'oldest' ? asc(issues.number) : desc(issues.number)

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
      milestoneTitle: milestones.title,
    })
    .from(issues)
    .innerJoin(users, eq(issues.authorId, users.id))
    .leftJoin(milestones, eq(milestones.id, issues.milestoneId))
    .where(and(...conds))
    .orderBy(order)
  return Promise.all(rows.map(async (r) => ({ ...r, authorAvatarUrl: await avatarSrc(r.authorAvatarUrl, 48) })))
}

/** Уникальные label'ы, использованные в issue списка (для фильтра). */
export async function getIssueLabelsInUse(templateId: string): Promise<string[]> {
  const rows = await db.select({ labels: issues.labels }).from(issues).where(eq(issues.templateId, templateId))
  const set = new Set<string>()
  for (const r of rows) for (const l of r.labels ?? []) set.add(l)
  return [...set].sort((a, b) => a.localeCompare(b))
}

export interface AssigneeRow {
  userId: string
  handle: string
  avatarUrl: string | null
}

/** Исполнители одного issue. */
export async function getIssueAssignees(issueId: string): Promise<AssigneeRow[]> {
  const rows = await db
    .select({ userId: users.id, handle: users.handle, avatarUrl: users.avatarUrl })
    .from(issueAssignees)
    .innerJoin(users, eq(issueAssignees.userId, users.id))
    .where(eq(issueAssignees.issueId, issueId))
    .orderBy(asc(users.handle))
  return Promise.all(rows.map(async (r) => ({ ...r, avatarUrl: await avatarSrc(r.avatarUrl, 48) })))
}

/** Исполнители для набора issue (батч, чтобы не было N+1 на списке). */
export async function getIssueAssigneesFor(issueIds: string[]): Promise<Record<string, AssigneeRow[]>> {
  const out: Record<string, AssigneeRow[]> = {}
  if (issueIds.length === 0) return out
  const rows = await db
    .select({ issueId: issueAssignees.issueId, userId: users.id, handle: users.handle, avatarUrl: users.avatarUrl })
    .from(issueAssignees)
    .innerJoin(users, eq(issueAssignees.userId, users.id))
    .where(inArray(issueAssignees.issueId, issueIds))
    .orderBy(asc(users.handle))
  const byId: Record<string, typeof rows> = {}
  for (const r of rows) (byId[r.issueId] ??= []).push(r)
  for (const [id, list] of Object.entries(byId)) {
    out[id] = await Promise.all(list.map(async (r) => ({ userId: r.userId, handle: r.handle, avatarUrl: await avatarSrc(r.avatarUrl, 36) })))
  }
  return out
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
  milestoneId: string | null
  milestoneTitle: string | null
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
      milestoneId: issues.milestoneId,
      milestoneTitle: milestones.title,
    })
    .from(issues)
    .innerJoin(users, eq(issues.authorId, users.id))
    .leftJoin(milestones, eq(milestones.id, issues.milestoneId))
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
