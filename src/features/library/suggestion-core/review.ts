// Вердикт рецензента. Причина измениться одна: правила, по которым голос
// принимается и перезаписывается.

import 'server-only'
import { eq } from 'drizzle-orm'
import { db, suggestionReviews } from '@/shared/db'
import { canViewList } from '@/core'
import { isVerdict } from '../review-model'
// eslint-disable-next-line boundaries/dependencies -- права коллаборатора живут в collab
import { isCollaborator } from '@/features/collab/queries'
// eslint-disable-next-line boundaries/dependencies -- уведомление автору правки: тот же кросс-фич-паттерн, что в actions.ts
import { notify } from '@/features/notifications/notify'

/**
 * ЯДРО РЕВЬЮ — без сессии.
 *
 * Вердикт один на рецензента и ПЕРЕЗАПИСЫВАЕТСЯ: иначе «одобрил → передумал»
 * оставляло бы оба состояния сразу, и текущее определить нечем. Новый вердикт
 * снимает прежний dismiss — переголосовавший после снятия иначе оставался бы
 * снятым, то есть его голос молча не считался бы.
 *
 * Автор правки своё же ревью не оставляет — как в GitHub.
 */
export async function reviewSuggestion(
  actorUserId: string,
  suggestionId: string,
  verdict: string,
  body: string,
): Promise<{ ok: true; verdict: string } | { ok: false; reason: string }> {
  if (!isVerdict(verdict)) return { ok: false, reason: 'verdict must be approve, changes or comment' }
  const text = body.trim().slice(0, 10_000)

  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId), with: { template: true } })
  if (!sug) return { ok: false, reason: 'not found' }
  if (sug.status !== 'open') return { ok: false, reason: `already ${sug.status}` } // закрытую правку не ревьюят
  if (sug.authorId === actorUserId) return { ok: false, reason: 'you cannot review your own suggestion' }
  // Ревьюит тот, кто список ВИДИТ: приватный чужому не показываем и вердикта в нём не принимаем.
  const isOwner = sug.template.ownerId === actorUserId
  if (!canViewList(sug.template, { isOwner, isCollaborator: !isOwner && (await isCollaborator(sug.templateId, actorUserId)) })) {
    return { ok: false, reason: 'not found' }
  }

  await db
    .insert(suggestionReviews)
    .values({ suggestionId, reviewerId: actorUserId, verdict, body: text })
    .onConflictDoUpdate({
      target: [suggestionReviews.suggestionId, suggestionReviews.reviewerId],
      set: { verdict, body: text, updatedAt: new Date(), dismissedAt: null, dismissedById: null, dismissReason: null },
    })

  // Автор правки должен узнать, что по ней высказались.
  await notify({ recipientId: sug.authorId, actorId: actorUserId, type: 'suggestion_comment', templateId: sug.templateId, suggestionId })
  return { ok: true, verdict }
}
