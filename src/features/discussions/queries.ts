import 'server-only'
import { and, desc, eq, ilike, sql } from 'drizzle-orm'
import { db, discussionComments, discussions, users } from '@/shared/db'
import { avatarSrc } from '@/shared/media'

export interface DiscussionRow {
  id: string
  number: number
  title: string
  category: string
  authorHandle: string
  authorAvatarUrl: string | null
  commentCount: number
  createdAt: Date
}

/** Треды списка (лента): фильтр по категории + поиск по заголовку. */
export async function getDiscussions(templateId: string, opts: { category?: string; q?: string } = {}): Promise<DiscussionRow[]> {
  const conds = [eq(discussions.templateId, templateId)]
  if (opts.category) conds.push(eq(discussions.category, opts.category))
  if (opts.q) conds.push(ilike(discussions.title, `%${opts.q}%`))
  const commentCount = sql<number>`(select count(*)::int from ${discussionComments} dc where dc.discussion_id = ${discussions.id})`
  const rows = await db
    .select({
      id: discussions.id,
      number: discussions.number,
      title: discussions.title,
      category: discussions.category,
      authorHandle: users.handle,
      authorAvatarUrl: users.avatarUrl,
      commentCount,
      createdAt: discussions.createdAt,
    })
    .from(discussions)
    .innerJoin(users, eq(discussions.authorId, users.id))
    .where(and(...conds))
    .orderBy(desc(discussions.createdAt))
  return Promise.all(rows.map(async (r) => ({ ...r, authorAvatarUrl: await avatarSrc(r.authorAvatarUrl, 40) })))
}

export async function getDiscussionCount(templateId: string): Promise<number> {
  const [r] = await db.select({ c: sql<number>`count(*)::int` }).from(discussions).where(eq(discussions.templateId, templateId))
  return r?.c ?? 0
}

export interface DiscussionThread {
  id: string
  number: number
  title: string
  body: string
  category: string
  authorId: string
  authorHandle: string
  authorAvatarUrl: string | null
  createdAt: Date
}

export async function getDiscussion(templateId: string, number: number): Promise<DiscussionThread | null> {
  const [r] = await db
    .select({
      id: discussions.id,
      number: discussions.number,
      title: discussions.title,
      body: discussions.body,
      category: discussions.category,
      authorId: discussions.authorId,
      authorHandle: users.handle,
      authorAvatarUrl: users.avatarUrl,
      createdAt: discussions.createdAt,
    })
    .from(discussions)
    .innerJoin(users, eq(discussions.authorId, users.id))
    .where(and(eq(discussions.templateId, templateId), eq(discussions.number, number)))
    .limit(1)
  if (!r) return null
  return { ...r, authorAvatarUrl: await avatarSrc(r.authorAvatarUrl, 48) }
}

export interface DiscussionCommentRow {
  id: string
  body: string
  authorId: string
  authorHandle: string
  authorAvatarUrl: string | null
  createdAt: Date
}

export async function getDiscussionComments(discussionId: string): Promise<DiscussionCommentRow[]> {
  const rows = await db
    .select({
      id: discussionComments.id,
      body: discussionComments.body,
      authorId: discussionComments.authorId,
      authorHandle: users.handle,
      authorAvatarUrl: users.avatarUrl,
      createdAt: discussionComments.createdAt,
    })
    .from(discussionComments)
    .innerJoin(users, eq(discussionComments.authorId, users.id))
    .where(eq(discussionComments.discussionId, discussionId))
    .orderBy(discussionComments.createdAt)
  return Promise.all(rows.map(async (r) => ({ ...r, authorAvatarUrl: await avatarSrc(r.authorAvatarUrl, 40) })))
}
