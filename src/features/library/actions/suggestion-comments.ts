'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, suggestionComments } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { rateLimit } from '@/shared/rate-limit'
import { notifyMany, notifyMentions } from '@/features/notifications/notify'
import { ensureWatch } from '@/features/watch/actions'
import { getWatcherIds } from '@/features/watch/queries'
import { collabStore, suggestionCommenterIds } from '@/features/collab-store/store'
import { canViewList } from '@/core'
import { ownerHandle } from './shared'

/**
 * Обсуждение предложения. Причина измениться одна — правила реплик: кто пишет,
 * кого извещаем, когда тред заперт.
 */

/**
 * Правка своего комментария к предложению.
 *
 * Только автор: чужие реплики не редактирует даже владелец списка — иначе в
 * обсуждении нельзя было бы доверять тому, что написано от чьего-то имени.
 * Пустое тело трактуем как отмену, а не как удаление: удаление — отдельное
 * намерение, и делать его побочным эффектом пустой формы опасно.
 */
export async function editSuggestionComment(commentId: string, body: string): Promise<{ ok: boolean }> {
  const session = await requireSession()
  const text = body.trim().slice(0, 20000)
  if (!text) return { ok: false }

  const [row] = await db
    .select({ authorId: suggestionComments.authorId, suggestionId: suggestionComments.suggestionId })
    .from(suggestionComments)
    .where(eq(suggestionComments.id, commentId))
    .limit(1)
  if (!row || row.authorId !== session.userId) return { ok: false }

  await db
    .update(suggestionComments)
    .set({ body: text, updatedAt: new Date() })
    .where(eq(suggestionComments.id, commentId))

  const sug = await db.query.suggestions.findFirst({ where: (x) => eq(x.id, row.suggestionId), with: { template: true } })
  if (sug) {
    const handle = await ownerHandle(sug.template.ownerId)
    revalidatePath(`/${handle}/${sug.template.slug}/suggestions/${sug.number ?? sug.id}`)
  }
  return { ok: true }
}

export async function addSuggestionComment(formData: FormData): Promise<void> {
  const session = await requireSession()
  const suggestionId = String(formData.get('suggestionId') ?? '')
  const body = String(formData.get('body') ?? '').trim().slice(0, 20000)
  const sug = await db.query.suggestions.findFirst({
    where: (s) => eq(s.id, suggestionId),
    with: { template: true },
  })
  if (!sug) return
  // Заперто — новых реплик нет ни у кого, включая владельца: замок, который
  // обходит тот, кто его повесил, ничего не значит для остальных.
  if (sug.lockedAt) return
  // Комментарий к правке — запись в тред списка: только если список видим комментатору
  // (список мог стать приватным/скрытым после публикации PR; reactions уже так гейтят).
  if (!canViewList(sug.template, { isOwner: sug.template.ownerId === session.userId })) return
  const handle = await ownerHandle(sug.template.ownerId)
  const path = `/${handle}/${sug.template.slug}/suggestions/${sug.id}`
  // Анти-спам: комментарий рассылает уведомления автору+владельцу+комментаторам+watcher'ам.
  if (!(await rateLimit(`sugcomment:${session.userId}`, 20, 5 * 60_000)).ok) redirect(`${path}?e=ratelimited`)
  if (!body) redirect(path)

  await collabStore.addSuggestionComment(sug.id, session.userId, body)
  await ensureWatch(sug.templateId)

  const [commenters, watchers] = await Promise.all([suggestionCommenterIds(sug.id), getWatcherIds(sug.templateId, 'suggestions')])
  const recipients = [sug.authorId, sug.template.ownerId, ...commenters, ...watchers]
  await notifyMany(recipients, { actorId: session.userId, type: 'suggestion_comment', templateId: sug.templateId, suggestionId: sug.id })
  await notifyMentions({ text: body, actorId: session.userId, templateId: sug.templateId })

  revalidatePath(path)
  redirect(path)
}
