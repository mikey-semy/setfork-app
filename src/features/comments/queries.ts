import 'server-only'
import { and, asc, eq } from 'drizzle-orm'
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
  anchorCurrent: TextAnchor | null
  anchorState: 'anchored' | 'reanchored' | 'orphaned'
  anchorConfidence: number | null
  anchorChangedAt: number | null
  contextSnapshot: string
  resolvedAt: Date | null
  comments: ThreadComment[]
}

/** Треды списка со всеми репликами. Пусто — комментариев нет (не ошибка). */
export async function getBlockThreads(templateId: string): Promise<BlockThread[]> {
  const threads = await db
    .select()
    .from(blockCommentThreads)
    .where(eq(blockCommentThreads.templateId, templateId))
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

  const byThread = new Map<string, ThreadComment[]>()
  for (const r of rows) {
    const list = byThread.get(r.threadId)
    const item: ThreadComment = {
      id: r.id,
      body: r.body,
      createdAt: r.createdAt,
      author: { handle: r.handle, name: r.name, avatarUrl: await avatarSrc(r.avatarUrl, 48) },
    }
    if (list) list.push(item)
    else byThread.set(r.threadId, [item])
  }

  return threads.map((t) => ({
    id: t.id,
    blockId: t.blockId,
    field: t.field as CommentField,
    createdVersion: t.createdVersion,
    anchorOriginal: t.anchorOriginal as unknown as TextAnchor,
    anchorCurrent: (t.anchorCurrent ?? null) as unknown as TextAnchor | null,
    anchorState: t.anchorState as BlockThread['anchorState'],
    anchorConfidence: t.anchorConfidence,
    anchorChangedAt: t.anchorChangedAt,
    contextSnapshot: t.contextSnapshot,
    resolvedAt: t.resolvedAt,
    comments: byThread.get(t.id) ?? [],
  }))
}

/** Тред + его список (для проверки прав в экшенах). */
export async function getThreadOwnerList(threadId: string): Promise<{ templateId: string } | null> {
  const [t] = await db
    .select({ templateId: blockCommentThreads.templateId })
    .from(blockCommentThreads)
    .where(and(eq(blockCommentThreads.id, threadId)))
    .limit(1)
  return t ?? null
}
