'use server'

import { and, asc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, suggestionReviews, suggestions, templates, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { avatarSrc } from '@/shared/media'
// eslint-disable-next-line boundaries/dependencies -- уведомление автору правки (тот же кросс-фич-паттерн, что в actions.ts)
import { notify } from '@/features/notifications/notify'
// eslint-disable-next-line boundaries/dependencies -- права коллаборатора из collab
import { isCollaborator } from '@/features/collab/queries'

/** Вердикты ревью. Явные значения — у Gitea «request changes» спрятан за Reject. */
export const VERDICTS = ['comment', 'approve', 'changes'] as const
export type Verdict = (typeof VERDICTS)[number]
const isVerdict = (v: unknown): v is Verdict => typeof v === 'string' && (VERDICTS as readonly string[]).includes(v)

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
  if (!isVerdict(verdict)) return
  const text = body.trim().slice(0, MAX_BODY)

  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId), with: { template: true } })
  if (!sug || sug.status !== 'open') return // закрытую правку не ревьюят
  if (sug.authorId === session.userId) return // себя не ревьюим

  await db
    .insert(suggestionReviews)
    .values({ suggestionId, reviewerId: session.userId, verdict, body: text })
    .onConflictDoUpdate({
      target: [suggestionReviews.suggestionId, suggestionReviews.reviewerId],
      set: { verdict, body: text, updatedAt: new Date() },
    })

  // Автор правки должен узнать, что по ней высказались.
  await notify({
    recipientId: sug.authorId,
    actorId: session.userId,
    type: 'suggestion_comment',
    templateId: sug.templateId,
    suggestionId,
  })
  revalidatePath('/', 'layout')
}

export interface ReviewView {
  id: string
  verdict: Verdict
  body: string
  createdAt: Date
  /** Голос блокирует принятие (запрошены правки от владельца/коллаборатора). */
  blocking: boolean
  reviewer: { handle: string; name: string | null; avatarUrl: string | null }
}

/**
 * Ревью правки. blocking считается ЗДЕСЬ, чтобы UI и проверка принятия
 * пользовались одним определением: «просит доработать» блокирует только от
 * владельца списка или коллаборатора — у случайного зрителя это совет, а не
 * стоп-кран (иначе кто угодно замораживал бы чужую правку).
 */
export async function getSuggestionReviews(suggestionId: string): Promise<ReviewView[]> {
  const rows = await db
    .select({
      id: suggestionReviews.id,
      verdict: suggestionReviews.verdict,
      body: suggestionReviews.body,
      createdAt: suggestionReviews.createdAt,
      reviewerId: suggestionReviews.reviewerId,
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

  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      verdict: r.verdict as Verdict,
      body: r.body,
      createdAt: r.createdAt,
      blocking:
        r.verdict === 'changes' &&
        !!meta &&
        (r.reviewerId === meta.ownerId || (await isCollaborator(meta.templateId, r.reviewerId))),
      reviewer: { handle: r.handle, name: r.name, avatarUrl: await avatarSrc(r.avatarUrl, 48) },
    })),
  )
}

/** Есть ли активное блокирующее «просит доработать». */
export async function hasBlockingReview(suggestionId: string): Promise<boolean> {
  const reviews = await getSuggestionReviews(suggestionId)
  return reviews.some((r) => r.blocking)
}

/** Снять своё ревью (передумал высказываться). */
export async function withdrawSuggestionReview(suggestionId: string): Promise<void> {
  const session = await requireSession()
  await db
    .delete(suggestionReviews)
    .where(and(eq(suggestionReviews.suggestionId, suggestionId), eq(suggestionReviews.reviewerId, session.userId)))
  revalidatePath('/', 'layout')
}
