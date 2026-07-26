'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { blockComments, blockCommentThreads, db, templates } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
// eslint-disable-next-line boundaries/dependencies -- права коллаборатора из collab (тот же кросс-фич-паттерн, что у library/gardener)
import { isCollaborator } from '@/features/collab/queries'
// eslint-disable-next-line boundaries/dependencies -- гейт видимости списка и его блоки из library
import { requireViewableMeta, requireViewableDetail } from '@/features/library/guard'
// eslint-disable-next-line boundaries/dependencies -- блоки версии из library
import { getVersionSteps } from '@/features/library/queries'
import { makeAnchor } from './anchor'
import { fieldText, isCommentField, type AnchorableBlock, type CommentField } from './fields'
import { reanchorThread, type ThreadAnchorState } from './reanchor'
import { getBlockThreads } from './queries'

const MAX_BODY = 10_000

/**
 * Завести тред к блоку. Якорь снимается СЕРВЕРОМ по присланному смещению —
 * клиенту доверять диапазон нельзя, а текст поля мы и так знаем.
 * Пустой диапазон (start === end) = комментарий к блоку целиком.
 */
export async function createBlockThread(
  owner: string,
  slug: string,
  blockId: string,
  field: string,
  start: number,
  end: number,
  body: string,
): Promise<void> {
  const session = await requireSession()
  const text = body.trim().slice(0, MAX_BODY)
  if (!text || !isCommentField(field)) return

  const [lang, detail] = await Promise.all([getLang(), requireViewableDetail(owner, slug)])
  if (!detail) return // приватный/скрытый список — как будто его нет

  const block = (detail.steps as AnchorableBlock[]).find((s) => s.blockId === blockId)
  if (!block) return // комментировать можно только существующий блок текущей версии

  const source = fieldText(block, field, lang)
  const anchor = makeAnchor(source, start, end)

  const [thread] = await db
    .insert(blockCommentThreads)
    .values({
      templateId: detail.tpl.id,
      blockId,
      field,
      createdVersion: detail.currentVersion?.version ?? detail.tpl.currentVersion,
      anchorOriginal: anchor as unknown as Record<string, unknown>,
      anchorCurrent: anchor as unknown as Record<string, unknown>,
      anchorState: 'anchored',
      anchorConfidence: 100,
      // Вмороженный контекст: тред покажет своё окружение даже когда текст уедет.
      contextSnapshot: source,
    })
    .returning()

  await db.insert(blockComments).values({ threadId: thread.id, authorId: session.userId, body: text })
  revalidatePath(`/${owner}/${slug}`)
}

/** Ответить в тред (реплика не имеет своего якоря — наследует тред, как в GitHub). */
export async function replyToBlockThread(owner: string, slug: string, threadId: string, body: string): Promise<void> {
  const session = await requireSession()
  const text = body.trim().slice(0, MAX_BODY)
  if (!text) return
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) return

  const [thread] = await db.select().from(blockCommentThreads).where(eq(blockCommentThreads.id, threadId)).limit(1)
  if (!thread || thread.templateId !== meta.id) return

  await db.insert(blockComments).values({ threadId, authorId: session.userId, body: text })
  await db.update(blockCommentThreads).set({ updatedAt: new Date() }).where(eq(blockCommentThreads.id, threadId))
  revalidatePath(`/${owner}/${slug}`)
}

/**
 * Разрешить/переоткрыть тред. Единица разрешения — ТРЕД, а не отдельная реплика
 * (модель PullRequestReviewThread у GitHub). Право: владелец, коллаборатор или
 * автор первой реплики.
 */
export async function setBlockThreadResolved(owner: string, slug: string, threadId: string, resolved: boolean): Promise<void> {
  const session = await requireSession()
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) return

  const [thread] = await db.select().from(blockCommentThreads).where(eq(blockCommentThreads.id, threadId)).limit(1)
  if (!thread || thread.templateId !== meta.id) return

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
  revalidatePath(`/${owner}/${slug}`)
}

/**
 * Пересчитать якоря всех тредов списка против ТЕКУЩЕЙ версии.
 * Вызывается после создания версии — аналог обновления позиций у GitLab при пуше.
 * Пишет только изменившиеся треды (reanchorThread возвращает null, если нечего).
 */
export async function syncBlockThreadAnchors(templateId: string): Promise<void> {
  const [tpl] = await db.select({ currentVersion: templates.currentVersion }).from(templates).where(eq(templates.id, templateId)).limit(1)
  if (!tpl) return
  const [lang, threads] = await Promise.all([getLang(), getBlockThreads(templateId)])
  if (!threads.length) return

  // Внутренний вызов после сохранения версии — гейт видимости здесь не при чём,
  // берём блоки текущей версии напрямую.
  const version = tpl.currentVersion
  const snap = await getVersionSteps(templateId, version)
  if (!snap) return
  const blocks = snap.steps as AnchorableBlock[]

  for (const t of threads) {
    const state: ThreadAnchorState = {
      blockId: t.blockId,
      field: t.field as CommentField,
      anchorOriginal: t.anchorOriginal,
      anchorCurrent: t.anchorCurrent,
      anchorState: t.anchorState,
      anchorConfidence: t.anchorConfidence,
      anchorChangedAt: t.anchorChangedAt,
    }
    const up = reanchorThread(state, blocks, version, lang)
    if (!up) continue
    await db
      .update(blockCommentThreads)
      .set({
        anchorCurrent: (up.anchorCurrent ?? null) as unknown as Record<string, unknown> | null,
        anchorState: up.anchorState,
        anchorConfidence: up.anchorConfidence,
        anchorChangedAt: up.anchorChangedAt,
        updatedAt: new Date(),
      })
      .where(eq(blockCommentThreads.id, t.id))
  }
}

