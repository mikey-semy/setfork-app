'use server'

import { asc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { blockComments, blockCommentThreads, db, suggestions, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { resolveListBySlug } from '@/shared/db/resolve-list'
// eslint-disable-next-line boundaries/dependencies -- открытие задачи через доменный порт
import { collabStore } from '@/features/collab-store/store'

/**
 * ТРЕД → ЗАДАЧА одной кнопкой.
 *
 * Обсуждение на пункте часто упирается в то, что решать надо не здесь: «это надо
 * переписать целиком», «источник устарел». Раньше выход был один — переписать
 * руками в новую задачу, потеряв и контекст, и ссылку назад.
 *
 * Задача создаётся С ЦИТАТОЙ обсуждения и ссылкой на предложение, а в тред
 * уходит ответ с номером задачи: связь видна с обеих сторон, и разговор не
 * обрывается «ушли решать куда-то ещё».
 *
 * Тред при этом НЕ закрывается автоматически: решение «вопрос снят» принимает
 * человек, а перенос в задачу его не снимает — он лишь меняет место.
 */
export async function threadToIssue(owner: string, slug: string, threadId: string): Promise<void> {
  // Сессия и язык друг от друга не зависят — берём разом.
  const [session, lang] = await Promise.all([requireSession(), getLang()])

  const [row] = await db
    .select({
      threadId: blockCommentThreads.id,
      suggestionId: blockCommentThreads.suggestionId,
      contextSnapshot: blockCommentThreads.contextSnapshot,
      templateId: suggestions.templateId,
      sugNumber: suggestions.number,
      sugNote: suggestions.note,
      lockedAt: suggestions.lockedAt,
    })
    .from(blockCommentThreads)
    .innerJoin(suggestions, eq(suggestions.id, blockCommentThreads.suggestionId))
    .where(eq(blockCommentThreads.id, threadId))
    .limit(1)
  if (!row || row.lockedAt) return // заперто — новых записей в тред не делаем

  // Права — ТЕ ЖЕ, что у обычного создания задачи: `collabStore.openIssue` сам
  // ничего не проверяет, и без этого любой, кто видит предложение, заводил бы
  // задачи в приватном списке. Заодно сверяем, что owner/slug из адреса — это
  // действительно список треда, а не чужой, подставленный в аргументы.
  const tpl = await resolveListBySlug(owner, slug)
  if (!tpl || tpl.id !== row.templateId) return
  const isOwner = tpl.ownerId === session.userId
  if (tpl.visibility === 'private' && !isOwner) return
  if (tpl.moderation !== 'active' && !isOwner) return

  // Реплики треда — тело задачи. Черновики ревью НЕ берём: они ещё никому не
  // показаны, и вытаскивать их в публичную задачу нельзя.
  const replies = await db
    .select({ body: blockComments.body, pending: blockComments.pending, handle: users.handle })
    .from(blockComments)
    .innerJoin(users, eq(users.id, blockComments.authorId))
    .where(eq(blockComments.threadId, threadId))
    .orderBy(asc(blockComments.createdAt))
  const visible = replies.filter((r) => !r.pending)
  if (visible.length === 0) return
  // Уже переносили — второй раз не заводим. Кнопка остаётся на месте, и без этой
  // проверки повторный клик плодил бы задачи-двойники с тем же обсуждением.
  if (visible.some((r) => /^→ #\d+$/.test(r.body.trim()))) return

  const sugPath = `/${owner}/${slug}/suggestions/${row.sugNumber ?? row.suggestionId}`
  const first = visible[0].body.replace(/\s+/g, ' ').trim()
  const title = (first.slice(0, 120) || row.sugNote.slice(0, 120) || 'discussion').trim()
  const body = [
    `${t('prThreadFromDiscussion', lang)} [#${row.sugNumber ?? ''}](${sugPath}).`,
    row.contextSnapshot ? `\n> ${row.contextSnapshot.replace(/\n/g, '\n> ').slice(0, 1000)}` : '',
    '',
    ...visible.map((r) => `**@${r.handle}:** ${r.body}`),
  ]
    .join('\n')
    .slice(0, 20000)

  const ins = await collabStore.openIssue(row.templateId, session.userId, title, body, [])
  if (!ins) return

  // Ответ в тред — чтобы связь была видна и отсюда, а не только из задачи.
  await db.insert(blockComments).values({
    threadId,
    authorId: session.userId,
    body: `→ #${ins.number}`,
  })
  await db.update(blockCommentThreads).set({ updatedAt: new Date() }).where(eq(blockCommentThreads.id, threadId))

  revalidatePath(sugPath)
  revalidatePath(`/${owner}/${slug}/issues`)
}
