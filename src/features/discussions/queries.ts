import 'server-only'
import { and, desc, eq, ilike, sql } from 'drizzle-orm'
import { db, discussionComments, discussions, users } from '@/shared/db'
import { cursorKey, keysetStep } from '@/shared/db/keyset'
import { encodeCursor, probeLimit, takePage, type Cursor, type FeedDirection } from '@/shared/lib/paging'
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

/**
 * ПОРЦИЯ ОБСУЖДЕНИЯ — тот же рецепт, что у треда задачи (см. issues/queries).
 *
 * Порядок показа `asc`: обсуждение читают с начала и дописывают в конец, поэтому «дальше»
 * значит «в будущее». Ключом, а не смещением, — из-за УДАЛЕНИЯ: снятая реплика сдвигает
 * всё, что ниже, и следующая порция по смещению перепрыгивает ровно одну.
 *
 * Раньше обсуждение отдавалось целиком, без предела.
 */
export async function getDiscussionCommentsPage(
  discussionId: string,
  perPage: number,
  cursor: Cursor | null = null,
  dir: FeedDirection = 'after',
): Promise<{ items: DiscussionCommentRow[]; next: string | null; prev: string | null }> {
  // Без курсора шага назад не существует: «перед началом» — не место.
  const back = dir === 'before' && cursor !== null
  const step = keysetStep(discussionComments.createdAt, discussionComments.id, cursor, {
    order: 'asc',
    dir: back ? 'before' : 'after',
  })
  const rows = await db
    .select({
      id: discussionComments.id,
      body: discussionComments.body,
      authorId: discussionComments.authorId,
      authorHandle: users.handle,
      authorAvatarUrl: users.avatarUrl,
      createdAt: discussionComments.createdAt,
      // Ключ ТЕКСТОМ: типизированная колонка приезжает без микросекунд (shared/db/keyset).
      cursorKey: cursorKey(discussionComments.createdAt),
    })
    .from(discussionComments)
    .innerJoin(users, eq(discussionComments.authorId, users.id))
    .where(and(eq(discussionComments.discussionId, discussionId), step.where))
    .orderBy(...step.order)
    .limit(probeLimit(perPage))

  // Отсекаем лишнюю строку разведчика ДО разворота — иначе отрезался бы не тот конец.
  const { items: taken, hasNext: more } = takePage(rows, perPage)
  const shown = step.reverse ? [...taken].reverse() : taken
  const at = (row: (typeof shown)[number] | undefined): string | null =>
    row ? encodeCursor({ key: row.cursorKey, id: row.id }) : null
  return {
    items: await Promise.all(
      shown.map(async ({ cursorKey: _k, ...r }) => ({ ...r, authorAvatarUrl: await avatarSrc(r.authorAvatarUrl, 40) })),
    ),
    next: back ? at(shown[shown.length - 1]) : more ? at(shown[shown.length - 1]) : null,
    prev: back ? (more ? at(shown[0]) : null) : cursor ? at(shown[0]) : null,
  }
}
