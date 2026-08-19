import 'server-only'
import { and, asc, desc, eq, ilike, sql, type SQL } from 'drizzle-orm'
import { db, discussionComments, discussions, users } from '@/shared/db'
import { cursorKey, keysetPage, keysetStep } from '@/shared/db/keyset'
import { likeContains } from '@/shared/db/like'
import { feedWindow, probeLimit, type Cursor, type FeedDirection } from '@/shared/lib/paging'
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
export interface DiscussionQuery {
  category?: string
  q?: string
}

/**
 * Условия отбора обсуждений — ОДИН источник на выдачу и на счёт.
 *
 * Порознь их писать нельзя: число страниц берётся из счёта, и разойдись он с выдачей
 * хоть на одно условие — листалка нарисует страницы, которых нет.
 */
function discussionConds(templateId: string, opts: DiscussionQuery): SQL[] {
  const conds: SQL[] = [eq(discussions.templateId, templateId)]
  if (opts.category) conds.push(eq(discussions.category, opts.category))
  if (opts.q) conds.push(ilike(discussions.title, likeContains(opts.q)))
  return conds
}

/** Сколько обсуждений подходит под ТОТ ЖЕ отбор — для числа страниц. */
export async function countDiscussions(templateId: string, opts: DiscussionQuery = {}): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(discussions)
    .where(and(...discussionConds(templateId, opts)))
  return r?.n ?? 0
}

/**
 * Обсуждения списка страницей.
 *
 * Каталог, а не лента: их фильтруют по разделу и ищут по названию. Раньше выдача шла без
 * предела и без доопределения порядка — `createdAt` у обсуждений одной операции совпадает.
 */
export async function getDiscussions(
  templateId: string,
  opts: DiscussionQuery = {},
  /** Окно страницы. Проверяется `feedWindow`: битый предел драйвер выбрасывает молча. */
  window?: { limit: number; offset?: number },
): Promise<DiscussionRow[]> {
  const conds = discussionConds(templateId, opts)
  const commentCount = sql<number>`(select count(*)::int from ${discussionComments} dc where dc.discussion_id = ${discussions.id})`
  const base = db
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
    .orderBy(desc(discussions.createdAt), asc(discussions.id))
  const w = window && feedWindow(window)
  const rows = await (w ? base.limit(w.limit).offset(w.offset) : base)
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

  const { shown, next, prev } = keysetPage(rows, perPage, cursor, { reverse: step.reverse })
  return {
    items: await Promise.all(
      shown.map(async ({ cursorKey: _k, ...r }) => ({ ...r, authorAvatarUrl: await avatarSrc(r.authorAvatarUrl, 40) })),
    ),
    next,
    prev,
  }
}
