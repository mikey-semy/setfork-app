import 'server-only'

import { asc, eq, inArray } from 'drizzle-orm'
import { db, suggestionReviews, suggestions, templates, users } from '@/shared/db'
import { avatarSrc } from '@/shared/media'
import { canViewList } from '@/core'
// eslint-disable-next-line boundaries/dependencies -- права коллаборатора из collab
import { isCollaborator } from '@/features/collab/queries'
import type { ReviewView, Verdict } from './review-model'

/**
 * ЧТЕНИЕ ревью правок. Файл сознательно БЕЗ 'use server': клиент эти функции не
 * зовёт (их читают RSC и серверные гейты слияния), а любой экспорт из
 * 'use server'-файла — сетевая точка входа, которую можно позвать с любыми
 * аргументами. Пока они жили рядом с мутациями, аноним по id правки получал тексты
 * ревью и ники рецензентов к ПРИВАТНОМУ списку (линза 02, F2).
 */

type ListMeta = {
  templateId: string
  ownerId: string
  visibility: 'public' | 'private'
  status: 'draft' | 'published'
  moderation: string
}

/** Список, к которому относится правка (владелец и состояние — для гейта зрителя). */
async function listOfSuggestion(suggestionId: string): Promise<ListMeta | undefined> {
  const [meta] = await db
    .select({
      templateId: suggestions.templateId,
      ownerId: templates.ownerId,
      visibility: templates.visibility,
      status: templates.status,
      moderation: templates.moderation,
    })
    .from(suggestions)
    .innerJoin(templates, eq(templates.id, suggestions.templateId))
    .where(eq(suggestions.id, suggestionId))
    .limit(1)
  return meta
}

/**
 * Ревью правки БЕЗ гейта зрителя — для серверных гейтов слияния, которые уже
 * проверили права вызывающего. Наружу отдаёт getSuggestionReviews.
 */
async function readReviews(suggestionId: string, meta: ListMeta | undefined, viewerId?: string): Promise<ReviewView[]> {
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

/**
 * Ревью правки для ЗРИТЕЛЯ. blocking считается ЗДЕСЬ, чтобы UI и проверка принятия
 * пользовались одним определением: «просит доработать» блокирует только от
 * владельца списка или коллаборатора — у случайного зрителя это совет, а не
 * стоп-кран (иначе кто угодно замораживал бы чужую правку).
 *
 * Зритель, который не видит список, не видит и переписку по правкам к нему: тексты
 * ревью и ники рецензентов — внутренняя кухня приватного/черновика/снятого модерацией.
 */
export async function getSuggestionReviews(suggestionId: string, viewerId?: string): Promise<ReviewView[]> {
  const meta = await listOfSuggestion(suggestionId)
  if (!meta) return []
  const isOwner = !!viewerId && meta.ownerId === viewerId
  const visible =
    canViewList(meta, { isOwner }) ||
    (!!viewerId && canViewList(meta, { isOwner, isCollaborator: await isCollaborator(meta.templateId, viewerId) }))
  if (!visible) return []
  return readReviews(suggestionId, meta, viewerId)
}

/** Есть ли активное блокирующее «просит доработать». */
export async function hasBlockingReview(suggestionId: string): Promise<boolean> {
  const reviews = await readReviews(suggestionId, await listOfSuggestion(suggestionId))
  return reviews.some((r) => r.blocking)
}

/**
 * Сколько одобрений у предложения. Нужно гейту «требовать N одобрений»: считаем
 * вердикты, а не людей в списке рецензентов — просьба посмотреть это ещё не «за».
 */
export async function countApprovals(suggestionId: string): Promise<number> {
  const reviews = await readReviews(suggestionId, await listOfSuggestion(suggestionId))
  // СНЯТОЕ одобрение не считается. Снятие задумано против бессрочной блокировки
  // («просит доработать»), но снять можно любой вердикт — и зачёркнутое «одобряю»
  // продолжало закрывать гейт требуемых одобрений. То есть мейнтейнер снимал чужое
  // одобрение, оно исчезало из панели, а слияние по-прежнему считало его за голос.
  return reviews.filter((r) => r.verdict === 'approve' && !r.dismissed).length
}
