'use server'

import { and, asc, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, suggestionReviews, suggestions, templates, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { avatarSrc } from '@/shared/media'
// eslint-disable-next-line boundaries/dependencies -- уведомление автору правки (тот же кросс-фич-паттерн, что в actions.ts)
import { notify } from '@/features/notifications/notify'
// eslint-disable-next-line boundaries/dependencies -- права коллаборатора из collab
import { isCollaborator } from '@/features/collab/queries'
import { isVerdict, type ReviewView, type Verdict } from './review-model'
import { reviewSuggestion } from './suggestion-core'


const MAX_BODY = 10_000

/**
 * Оставить/переписать своё ревью правки.
 *
 * Один активный вердикт на рецензента (unique-индекс): повторное ревью
 * ПЕРЕЗАПИСЫВАЕТ прежнее. Иначе «одобрил → передумал» оставляло бы оба
 * состояния сразу, и непонятно, какое из них текущее.
 *
 * Автор правки своё же ревью не оставляет — как в GitHub.
 */
export async function submitSuggestionReview(suggestionId: string, verdict: string, body: string): Promise<void> {
  const session = await requireSession()
  await reviewSuggestion(session.userId, suggestionId, verdict, body)
  revalidatePath('/', 'layout')
}

/**
 * Ревью правки. blocking считается ЗДЕСЬ, чтобы UI и проверка принятия
 * пользовались одним определением: «просит доработать» блокирует только от
 * владельца списка или коллаборатора — у случайного зрителя это совет, а не
 * стоп-кран (иначе кто угодно замораживал бы чужую правку).
 */
export async function getSuggestionReviews(suggestionId: string, viewerId?: string): Promise<ReviewView[]> {
  const rows = await db
    .select({
      id: suggestionReviews.id,
      verdict: suggestionReviews.verdict,
      body: suggestionReviews.body,
      createdAt: suggestionReviews.createdAt,
      reviewerId: suggestionReviews.reviewerId,
      dismissedAt: suggestionReviews.dismissedAt,
      dismissedById: suggestionReviews.dismissedById,
      dismissReason: suggestionReviews.dismissReason,
      handle: users.handle,
      name: users.name,
      avatarUrl: users.avatarUrl,
    })
    .from(suggestionReviews)
    .innerJoin(users, eq(users.id, suggestionReviews.reviewerId))
    .where(eq(suggestionReviews.suggestionId, suggestionId))
    .orderBy(asc(suggestionReviews.createdAt))
  if (!rows.length) return []

  // Владелец списка и его id — одним запросом: по ним решаем, блокирующий ли голос.
  const [meta] = await db
    .select({ templateId: suggestions.templateId, ownerId: templates.ownerId })
    .from(suggestions)
    .innerJoin(templates, eq(templates.id, suggestions.templateId))
    .where(eq(suggestions.id, suggestionId))
    .limit(1)

  // Ники снявших — одним запросом на всех: в цикле это N+1 ради подписи «снял @kто».
  const dismisserIds = [...new Set(rows.map((r) => r.dismissedById).filter((x): x is string => !!x))]
  const dismisserHandles = new Map<string, string>(
    dismisserIds.length
      ? (await db.select({ id: users.id, handle: users.handle }).from(users).where(inArray(users.id, dismisserIds))).map((u) => [u.id, u.handle])
      : [],
  )

  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      verdict: r.verdict as Verdict,
      body: r.body,
      createdAt: r.createdAt,
      // Снятый голос не блокирует — ровно это и означает «снять ревью». Проверка
      // здесь, а не у гейта: определение блокировки должно остаться одно.
      blocking:
        r.verdict === 'changes' &&
        !r.dismissedAt &&
        !!meta &&
        (r.reviewerId === meta.ownerId || (await isCollaborator(meta.templateId, r.reviewerId))),
      dismissed: r.dismissedAt
        ? { by: dismisserHandles.get(r.dismissedById ?? '') ?? null, reason: r.dismissReason ?? '', at: r.dismissedAt }
        : null,
      isMine: !!viewerId && r.reviewerId === viewerId,
      reviewer: { handle: r.handle, name: r.name, avatarUrl: await avatarSrc(r.avatarUrl, 48) },
    })),
  )
}

/** Есть ли активное блокирующее «просит доработать». */
export async function hasBlockingReview(suggestionId: string): Promise<boolean> {
  const reviews = await getSuggestionReviews(suggestionId)
  return reviews.some((r) => r.blocking)
}

/**
 * Сколько одобрений у предложения. Нужно гейту «требовать N одобрений»: считаем
 * вердикты, а не людей в списке рецензентов — просьба посмотреть это ещё не «за».
 */
export async function countApprovals(suggestionId: string): Promise<number> {
  const reviews = await getSuggestionReviews(suggestionId)
  return reviews.filter((r) => r.verdict === 'approve').length
}

/**
 * Снять ЧУЖОЕ ревью — как Dismiss review у GitHub.
 *
 * Зачем: «просит доработать» блокирует принятие бессрочно, и один рецензент, ушедший
 * в отпуск, замораживает предложение навсегда. Право — у владельца списка и
 * коллабораторов: тех же, чей голос вообще способен блокировать.
 *
 * Ревью при этом НЕ удаляется. Оно остаётся в истории со ссылкой на снявшего и
 * причиной: снятие чужого голоса — заметное решение, и оно должно быть видно, а не
 * выглядеть так, будто рецензент и не высказывался. Причина обязательна.
 */
export async function dismissSuggestionReview(suggestionId: string, reviewerHandle: string, reason: string): Promise<{ ok: boolean }> {
  const session = await requireSession()
  const text = reason.trim().slice(0, 500)
  if (!text) return { ok: false } // без причины — тихий обход ревью

  // Рецензента адресуем НИКОМ, а не id: ник и так виден на странице, а id
  // пользователя выносить в клиент ради этой кнопки незачем.
  const [reviewer] = await db.select({ id: users.id }).from(users).where(eq(users.handle, reviewerHandle)).limit(1)
  if (!reviewer) return { ok: false }
  const reviewerId = reviewer.id
  if (reviewerId === session.userId) return { ok: false } // своё снимают «убрать ревью», а не так

  const [meta] = await db
    .select({ templateId: suggestions.templateId, ownerId: templates.ownerId, status: suggestions.status })
    .from(suggestions)
    .innerJoin(templates, eq(templates.id, suggestions.templateId))
    .where(eq(suggestions.id, suggestionId))
    .limit(1)
  if (!meta || meta.status !== 'open') return { ok: false }
  if (meta.ownerId !== session.userId && !(await isCollaborator(meta.templateId, session.userId))) return { ok: false }

  const [row] = await db
    .update(suggestionReviews)
    .set({ dismissedAt: new Date(), dismissedById: session.userId, dismissReason: text })
    .where(and(eq(suggestionReviews.suggestionId, suggestionId), eq(suggestionReviews.reviewerId, reviewerId)))
    .returning({ id: suggestionReviews.id })
  if (!row) return { ok: false }

  // Рецензент должен узнать, что его вердикт сняли: иначе он выяснит это случайно.
  await notify({ recipientId: reviewerId, actorId: session.userId, templateId: meta.templateId, suggestionId, type: 'review_dismissed' })
  revalidatePath('/', 'layout')
  return { ok: true }
}

/** Снять своё ревью (передумал высказываться). */
export async function withdrawSuggestionReview(suggestionId: string): Promise<void> {
  const session = await requireSession()
  await db
    .delete(suggestionReviews)
    .where(and(eq(suggestionReviews.suggestionId, suggestionId), eq(suggestionReviews.reviewerId, session.userId)))
  revalidatePath('/', 'layout')
}
