import 'server-only'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { blockComments, blockCommentThreads, db, users } from '@/shared/db'
import { avatarSrc } from '@/shared/media'
import type { TextAnchor } from './anchor'
import type { CommentField } from './fields'

export interface ThreadComment {
  id: string
  body: string
  createdAt: Date
  author: { handle: string; name: string | null; avatarUrl: string | null }
}

export interface BlockThread {
  id: string
  blockId: string
  field: CommentField
  createdVersion: number
  anchorOriginal: TextAnchor
  contextSnapshot: string
  resolvedAt: Date | null
  comments: ThreadComment[]
}

/**
 * Review-треды одного предложения (PR). Состояние якоря здесь НЕ считается —
 * его вычисляет threadState() на рендере против предложенных пунктов.
 */
/**
 * Сколько обсуждений на пунктах ещё не решено.
 *
 * Нужен и гейту слияния, и вкладке проверок — считаем в одном месте, чтобы
 * «нельзя слить» и «в проверках красное» никогда не расходились.
 */
export async function countUnresolvedThreads(suggestionId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(blockCommentThreads)
    .where(and(eq(blockCommentThreads.suggestionId, suggestionId), isNull(blockCommentThreads.resolvedAt)))
  return row?.n ?? 0
}

export async function getSuggestionThreads(suggestionId: string): Promise<BlockThread[]> {
  const threads = await db
    .select()
    .from(blockCommentThreads)
    .where(eq(blockCommentThreads.suggestionId, suggestionId))
    .orderBy(asc(blockCommentThreads.createdAt))
  if (!threads.length) return []

  const rows = await db
    .select({
      id: blockComments.id,
      threadId: blockComments.threadId,
      body: blockComments.body,
      createdAt: blockComments.createdAt,
      handle: users.handle,
      name: users.name,
      avatarUrl: users.avatarUrl,
    })
    .from(blockComments)
    .innerJoin(users, eq(users.id, blockComments.authorId))
    .orderBy(asc(blockComments.createdAt))

  // Аватары резолвятся параллельно: подпись URL — сетевая операция, а реплик
  // в треде бывает много.
  const withAvatars = await Promise.all(rows.map(async (r) => ({ r, avatarUrl: await avatarSrc(r.avatarUrl, 48) })))

  const byThread = new Map<string, ThreadComment[]>()
  for (const { r, avatarUrl } of withAvatars) {
    const item: ThreadComment = {
      id: r.id,
      body: r.body,
      createdAt: r.createdAt,
      author: { handle: r.handle, name: r.name, avatarUrl },
    }
    const list = byThread.get(r.threadId)
    if (list) list.push(item)
    else byThread.set(r.threadId, [item])
  }

  return threads.map((t) => ({
    id: t.id,
    blockId: t.blockId,
    field: t.field as CommentField,
    createdVersion: t.createdVersion,
    anchorOriginal: t.anchorOriginal as unknown as TextAnchor,
    contextSnapshot: t.contextSnapshot,
    resolvedAt: t.resolvedAt,
    comments: byThread.get(t.id) ?? [],
  }))
}
