import 'server-only'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { blockComments, blockCommentThreads, db, users } from '@/shared/db'
import { avatarSrc } from '@/shared/media'
import type { TextAnchor } from './anchor'
import type { CommentField } from './fields'

export interface ThreadComment {
  id: string
  body: string
  createdAt: Date
  author: { handle: string; name: string | null; avatarUrl: string | null }
  /** Черновик ревью: видно только автору, пока он не отправит ревью. */
  pending: boolean
  /** Предложенный текст поля (null — обычное замечание словами). */
  suggestedText: string | null
  /** Когда предложение применили — второй раз применять нечего. */
  appliedAt: Date | null
}

export interface BlockThread {
  id: string
  blockId: string
  field: CommentField
  createdVersion: number
  anchorOriginal: TextAnchor
  contextSnapshot: string
  /** Язык снимка — на нём и надо сверять «устарело» (см. schema). */
  contextLang: string
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
  // Тред из одних черновиков не блокирует: автор ревью его ещё никому не показал.
  // Поэтому считаем только треды, где есть хотя бы одна ОТПРАВЛЕННАЯ реплика.
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(blockCommentThreads)
    .where(
      and(
        eq(blockCommentThreads.suggestionId, suggestionId),
        isNull(blockCommentThreads.resolvedAt),
        sql`exists (select 1 from ${blockComments} bc where bc.thread_id = ${blockCommentThreads.id} and bc.pending = false)`,
      ),
    )
  return row?.n ?? 0
}

export async function getSuggestionThreads(suggestionId: string, viewerId?: string): Promise<BlockThread[]> {
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
      pending: blockComments.pending,
      authorId: blockComments.authorId,
      suggestedText: blockComments.suggestedText,
      appliedAt: blockComments.appliedAt,
    })
    .from(blockComments)
    .innerJoin(users, eq(users.id, blockComments.authorId))
    // ТОЛЬКО реплики этих тредов. Условия не было вовсе: страница читала ВСЕ
    // комментарии базы и подписывала аватар каждому автору — по сетевому вызову на
    // строку. Наружу лишнее не попадало (отсеивалось при группировке), поэтому и не
    // замечалось: дефект был не в ответе, а в его цене.
    .where(inArray(blockComments.threadId, threads.map((t) => t.id)))
    .orderBy(asc(blockComments.createdAt))

  // Черновики ревью видит только их автор — фильтруем ДО резолва аватаров,
  // чтобы не подписывать URL для того, что не будет показано.
  const visible = rows.filter((r) => !r.pending || (!!viewerId && r.authorId === viewerId))

  // Аватары резолвятся параллельно: подпись URL — сетевая операция, а реплик
  // в треде бывает много.
  const withAvatars = await Promise.all(visible.map(async (r) => ({ r, avatarUrl: await avatarSrc(r.avatarUrl, 48) })))

  const byThread = new Map<string, ThreadComment[]>()
  for (const { r, avatarUrl } of withAvatars) {
    const item: ThreadComment = {
      id: r.id,
      body: r.body,
      createdAt: r.createdAt,
      author: { handle: r.handle, name: r.name, avatarUrl },
      pending: r.pending,
      suggestedText: r.suggestedText,
      appliedAt: r.appliedAt,
    }
    const list = byThread.get(r.threadId)
    if (list) list.push(item)
    else byThread.set(r.threadId, [item])
  }

  // Тред, у которого нет ни одной видимой реплики (только чужие черновики), не
  // показываем: иначе на диффе висел бы пустой значок обсуждения.
  return threads
    .filter((t) => (byThread.get(t.id) ?? []).length > 0)
    .map((t) => ({
    id: t.id,
    blockId: t.blockId,
    field: t.field as CommentField,
    createdVersion: t.createdVersion,
    anchorOriginal: t.anchorOriginal as unknown as TextAnchor,
    contextSnapshot: t.contextSnapshot,
    contextLang: t.contextLang,
    resolvedAt: t.resolvedAt,
    comments: byThread.get(t.id) ?? [],
  }))
}
