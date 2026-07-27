'use server'

import { and, eq, inArray, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { blockComments, blockCommentThreads, db, suggestions } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
// eslint-disable-next-line boundaries/dependencies -- права коллаборатора из collab
import { isCollaborator } from '@/features/collab/queries'
// eslint-disable-next-line boundaries/dependencies -- гейт видимости списка из library
import { requireViewableMeta } from '@/features/library/guard'
// eslint-disable-next-line boundaries/dependencies -- предлагаемые блоки (ветка или items) — один источник
import { suggestionBlocks } from '@/features/library/suggestion-blocks'
import { makeAnchor } from './anchor'
import { locateQuote } from './quote'
import { fieldText, isCommentField, type AnchorableBlock } from './fields'

const MAX_BODY = 10_000

/**
 * Завести review-тред к пункту ВНУТРИ ПРЕДЛОЖЕНИЯ (как комментарий к строке в
 * Files changed). Вне предложения комментариев к пунктам нет — при обычном
 * просмотре списка их не бывает, как и в GitHub при чтении кода.
 *
 * Клиент присылает ВЫДЕЛЕННЫЙ ТЕКСТ (или пусто = ко всему пункту), а не
 * координаты: тексты рендерятся Markdown'ом, и смещения в DOM не совпадают со
 * смещениями в исходной строке, по которой потом ищется якорь. Место находит
 * сервер; не нашёл — тред честно становится комментарием ко всему пункту.
 */
export async function createBlockThread(
  owner: string,
  slug: string,
  suggestionId: string,
  blockId: string,
  field: string,
  quote: string,
  body: string,
  /** true — черновик ревью: замечание видно только автору до отправки пачкой. */
  pending = false,
): Promise<void> {
  const session = await requireSession()
  const text = body.trim().slice(0, MAX_BODY)
  if (!text || !isCommentField(field)) return

  const [lang, meta] = await Promise.all([getLang(), requireViewableMeta(owner, slug)])
  if (!meta) return // приватный/скрытый список — как будто его нет

  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId) })
  if (!sug || sug.templateId !== meta.id) return

  // Якорь снимаем по ПРЕДЛОЖЕННОМУ блоку: обсуждают то, что предлагают. У branch-PR
  // это tip ветки, а не items — иначе на ветке блок не находился и тред не создавался.
  const blocks = (await suggestionBlocks(sug, owner, slug)) as unknown as AnchorableBlock[]
  const block = blocks.find((b) => b.blockId === blockId)
  if (!block) return

  const source = fieldText(block, field, lang)
  const at = locateQuote(source, quote.trim())
  const anchor = makeAnchor(source, at.start, at.end)

  const [thread] = await db
    .insert(blockCommentThreads)
    .values({
      suggestionId,
      blockId,
      field,
      createdVersion: sug.baseVersion,
      anchorOriginal: anchor as unknown as Record<string, unknown>,
      // Вмороженный контекст: тред покажет своё окружение, даже когда правку обновят.
      contextSnapshot: source,
    })
    .returning()

  await db.insert(blockComments).values({ threadId: thread.id, authorId: session.userId, body: text, pending })
  revalidatePath(`/${owner}/${slug}/suggestions/${suggestionId}`)
}

/** Ответить в тред (реплика без своего якоря — наследует тред, как в GitHub). */
export async function replyToBlockThread(owner: string, slug: string, threadId: string, body: string, pending = false): Promise<void> {
  const session = await requireSession()
  const text = body.trim().slice(0, MAX_BODY)
  if (!text) return
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) return

  const thread = await threadInList(threadId, meta.id)
  if (!thread) return

  await db.insert(blockComments).values({ threadId, authorId: session.userId, body: text, pending })
  await db.update(blockCommentThreads).set({ updatedAt: new Date() }).where(eq(blockCommentThreads.id, threadId))
  revalidatePath(`/${owner}/${slug}/suggestions/${thread.suggestionId}`)
}

/**
 * Разрешить/переоткрыть тред. Единица разрешения — ТРЕД, а не отдельная реплика
 * (модель PullRequestReviewThread у GitHub). Право: владелец списка,
 * коллаборатор или автор первой реплики.
 */
export async function setBlockThreadResolved(owner: string, slug: string, threadId: string, resolved: boolean): Promise<void> {
  const session = await requireSession()
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) return

  const thread = await threadInList(threadId, meta.id)
  if (!thread) return

  const [first] = await db
    .select({ authorId: blockComments.authorId })
    .from(blockComments)
    .where(eq(blockComments.threadId, threadId))
    .limit(1)
  const allowed =
    meta.ownerId === session.userId || first?.authorId === session.userId || (await isCollaborator(meta.id, session.userId))
  if (!allowed) return

  await db
    .update(blockCommentThreads)
    .set({
      resolvedAt: resolved ? new Date() : null,
      resolvedById: resolved ? session.userId : null,
      updatedAt: new Date(),
    })
    .where(eq(blockCommentThreads.id, threadId))
  revalidatePath(`/${owner}/${slug}/suggestions/${thread.suggestionId}`)
}

/** Тред + проверка, что он принадлежит предложению ЭТОГО списка (защита от подмены id). */
async function threadInList(threadId: string, listId: string): Promise<{ suggestionId: string } | null> {
  const [row] = await db
    .select({ suggestionId: blockCommentThreads.suggestionId, templateId: suggestions.templateId })
    .from(blockCommentThreads)
    .innerJoin(suggestions, eq(suggestions.id, blockCommentThreads.suggestionId))
    .where(eq(blockCommentThreads.id, threadId))
    .limit(1)
  if (!row || row.templateId !== listId) return null
  return { suggestionId: row.suggestionId }
}

/**
 * Отправить накопленные черновики ревью — все замечания текущего пользователя по
 * этому предложению становятся видимыми одним движением.
 *
 * Так рецензент может подумать и переписать: сейчас каждое замечание уходило
 * мгновенно, и «беру слова назад» приходилось писать отдельной репликой.
 */
export async function submitPendingComments(owner: string, slug: string, suggestionId: string): Promise<number> {
  const session = await requireSession()
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) return 0

  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId) })
  if (!sug || sug.templateId !== meta.id) return 0

  const ids = await db
    .select({ id: blockComments.id })
    .from(blockComments)
    .innerJoin(blockCommentThreads, eq(blockCommentThreads.id, blockComments.threadId))
    .where(
      and(
        eq(blockCommentThreads.suggestionId, suggestionId),
        eq(blockComments.authorId, session.userId),
        eq(blockComments.pending, true),
      ),
    )
  if (ids.length === 0) return 0

  await db
    .update(blockComments)
    .set({ pending: false, updatedAt: new Date() })
    .where(inArray(blockComments.id, ids.map((r) => r.id)))
  revalidatePath(`/${owner}/${slug}/suggestions/${sug.number ?? suggestionId}`)
  return ids.length
}

/** Удалить свой черновик замечания (пока он не отправлен — это ничей комментарий). */
export async function discardPendingComment(owner: string, slug: string, commentId: string): Promise<void> {
  const session = await requireSession()
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) return

  const [row] = await db
    .select({
      threadId: blockComments.threadId,
      suggestionId: blockCommentThreads.suggestionId,
      templateId: suggestions.templateId,
      authorId: blockComments.authorId,
      pending: blockComments.pending,
    })
    .from(blockComments)
    .innerJoin(blockCommentThreads, eq(blockCommentThreads.id, blockComments.threadId))
    .innerJoin(suggestions, eq(suggestions.id, blockCommentThreads.suggestionId))
    .where(eq(blockComments.id, commentId))
    .limit(1)
  if (!row || row.templateId !== meta.id || row.authorId !== session.userId || !row.pending) return

  await db.delete(blockComments).where(eq(blockComments.id, commentId))
  // ЭТОТ тред без реплик осиротел бы — удаляем его (и только его).
  const [left] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(blockComments)
    .where(eq(blockComments.threadId, row.threadId))
  if ((left?.n ?? 0) === 0) {
    await db.delete(blockCommentThreads).where(eq(blockCommentThreads.id, row.threadId))
  }
  revalidatePath(`/${owner}/${slug}/suggestions/${row.suggestionId}`)
}
