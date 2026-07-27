'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { councilExperts, db, milestones, suggestionAssignees, suggestionReviewRequests, suggestions, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { enqueueJob } from '@/shared/jobs/queue'
// eslint-disable-next-line boundaries/dependencies -- права коллаборатора из collab
import { isCollaborator } from '@/features/collab/queries'
import { cleanLabels } from '@/shared/lib/labels'
import { addClosingRef, closingRefs, removeClosingRef } from './closing-refs'
// eslint-disable-next-line boundaries/dependencies -- набор кастомных метоk списка
import { getListLabels } from '@/features/issues/queries'
// eslint-disable-next-line boundaries/dependencies -- уведомление о просьбе посмотреть правку
import { notify } from '@/features/notifications/notify'

/**
 * ПАКЕТНЫЕ действия над выбранными предложениями — как множественный выбор в
 * списке PR у GitHub: отметил несколько, поставил метку или закрыл разом.
 *
 * Права проверяются НА КАЖДОМ предложении отдельно (теми же экшенами), а не один
 * раз на пачку: иначе достаточно было бы подмешать в список чужой id. То, на что
 * права нет, молча пропускаем — как и одиночные экшены.
 */
export async function bulkSuggestionAction(
  ids: string[],
  op: { kind: 'label'; label: string } | { kind: 'milestone'; milestoneId: string } | { kind: 'close' },
): Promise<void> {
  const uniq = [...new Set(ids.filter(Boolean))].slice(0, 100)
  for (const id of uniq) {
    if (op.kind === 'close') {
      await closeSuggestion(id)
    } else if (op.kind === 'milestone') {
      await setSuggestionMilestone(id, op.milestoneId)
    } else {
      // Метку ДОБАВЛЯЕМ к имеющимся, а не заменяем набор: пакетное «поставить
      // метку» не должно снимать чужие.
      const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, id) })
      if (!sug) continue
      const cur = (sug.labels as string[] | null) ?? []
      if (!cur.includes(op.label)) await setSuggestionLabels(id, [...cur, op.label])
    }
  }
}

/**
 * Привязать/отвязать задачу — дописать или убрать `closes #N` в тексте правки.
 *
 * Источник правды остаётся ОДИН: строка в тексте. Пикер и набранное руками
 * «closes #12» — одно и то же, поэтому авто-закрытие при слиянии не пришлось
 * трогать вовсе, а связь видна прямо в описании правки.
 *
 * Право — у автора и у тех, кто ведёт предложения: это утверждение о том, что
 * правка закрывает задачу, а не косметика.
 */
export async function toggleClosingRef(suggestionId: string, number: number): Promise<void> {
  const session = await requireSession()
  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId), with: { template: true } })
  if (!sug || sug.status !== 'open' || !Number.isInteger(number) || number <= 0) return
  const can =
    session.userId === sug.authorId ||
    session.userId === sug.template.ownerId ||
    (await isCollaborator(sug.templateId, session.userId))
  if (!can) return

  // Добавление и удаление — в модуле, который ВЛАДЕЕТ синтаксисом ссылки: своя
  // регулярка здесь разошлась бы с разбором при первом же новом ключевом слове.
  const next = closingRefs(sug.note).includes(number)
    ? removeClosingRef(sug.note, number)
    : addClosingRef(sug.note, number)
  await db.update(suggestions).set({ note: next.slice(0, 300) }).where(eq(suggestions.id, sug.id))
  await revalidateSuggestion(sug.template.ownerId, sug.template.slug, sug.number ?? sug.id)
}

/**
 * Запереть/отпереть обсуждение предложения (владелец и коллаборанты).
 *
 * Отдельно от закрытия правки: спор может уйти в сторону, когда решение уже
 * принято, и закрывать правку ради тишины — подмена. Заперто ≠ решено.
 */
export async function setSuggestionLocked(suggestionId: string, locked: boolean): Promise<void> {
  const loaded = await loadForManage(suggestionId)
  if (!loaded) return
  const { sug, session } = loaded
  await db
    .update(suggestions)
    .set({ lockedAt: locked ? new Date() : null, lockedById: locked ? session.userId : null })
    .where(eq(suggestions.id, sug.id))
  await revalidateSuggestion(sug.template.ownerId, sug.template.slug, sug.number ?? sug.id)
}

/** Закрыть предложение — то же право, что у остальных пакетных действий. */
async function closeSuggestion(suggestionId: string): Promise<void> {
  const loaded = await loadForManage(suggestionId)
  if (!loaded || loaded.sug.status !== 'open') return
  const { sug, session } = loaded
  await db.update(suggestions).set({ status: 'rejected', resolvedAt: new Date() }).where(eq(suggestions.id, sug.id))
  if (sug.authorId !== session.userId) {
    await notify({
      recipientId: sug.authorId,
      actorId: session.userId,
      type: 'suggestion_rejected',
      templateId: sug.templateId,
      suggestionId: sug.id,
    })
  }
  await revalidateSuggestion(sug.template.ownerId, sug.template.slug, sug.number ?? sug.id)
}

/**
 * Метки, исполнители и этап ПРАВКИ — та же модель, что у задач.
 *
 * Отдельный файл, а не ветка внутри задачных экшенов: сущность другая, а вот
 * ПРАВИЛА общие — чистка ярлыков (`cleanLabels`) и набор кастомных метоk берутся
 * у задач, чтобы список допустимых метоk был один на список, а не два.
 */

/** Правку ведут те, кто может пушить: владелец списка или коллаборатор. */
async function loadForManage(suggestionId: string) {
  const session = await requireSession()
  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId), with: { template: true } })
  if (!sug) return null
  const can = session.userId === sug.template.ownerId || (await isCollaborator(sug.template.id, session.userId))
  if (!can) return null
  return { sug, session }
}

async function revalidateSuggestion(ownerId: string, slug: string, key: string | number): Promise<void> {
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, ownerId)).limit(1)
  if (u) revalidatePath(`/${u.handle}/${slug}/suggestions/${key}`)
}

export async function setSuggestionLabels(suggestionId: string, labels: string[]): Promise<void> {
  const loaded = await loadForManage(suggestionId)
  if (!loaded) return
  const { sug } = loaded
  const valid = new Set((await getListLabels(sug.templateId)).map((l) => l.id))
  const cleaned = cleanLabels(labels, valid)
  await db.update(suggestions).set({ labels: cleaned }).where(eq(suggestions.id, sug.id))
  await revalidateSuggestion(sug.template.ownerId, sug.template.slug, sug.number ?? sug.id)
}

/** Назначить/снять исполнителя по handle (переключатель, как у задач). */
export async function toggleSuggestionAssignee(suggestionId: string, handle: string): Promise<void> {
  const loaded = await loadForManage(suggestionId)
  if (!loaded) return
  const { sug } = loaded

  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.handle, handle)).limit(1)
  if (!u) return
  const [existing] = await db
    .select({ id: suggestionAssignees.id })
    .from(suggestionAssignees)
    .where(and(eq(suggestionAssignees.suggestionId, sug.id), eq(suggestionAssignees.userId, u.id)))
    .limit(1)
  if (existing) await db.delete(suggestionAssignees).where(eq(suggestionAssignees.id, existing.id))
  else await db.insert(suggestionAssignees).values({ suggestionId: sug.id, userId: u.id })
  await revalidateSuggestion(sug.template.ownerId, sug.template.slug, sug.number ?? sug.id)
}

/** Привязать правку к этапу; пустая строка — снять. Этап должен быть ЭТОГО списка. */
export async function setSuggestionMilestone(suggestionId: string, milestoneId: string): Promise<void> {
  const loaded = await loadForManage(suggestionId)
  if (!loaded) return
  const { sug } = loaded

  let next: string | null = null
  if (milestoneId) {
    const [m] = await db
      .select({ id: milestones.id })
      .from(milestones)
      .where(and(eq(milestones.id, milestoneId), eq(milestones.templateId, sug.templateId)))
      .limit(1)
    if (!m) return // чужой этап не привязываем
    next = m.id
  }
  await db.update(suggestions).set({ milestoneId: next }).where(eq(suggestions.id, sug.id))
  await revalidateSuggestion(sug.template.ownerId, sug.template.slug, sug.number ?? sug.id)
}

/**
 * Черновик ↔ готово к ревью.
 *
 * Право у автора правки и у тех, кто может пушить: автор дописывает, мейнтейнер
 * может вернуть в черновик, если правку предъявили рано.
 */
export async function setSuggestionDraft(suggestionId: string, draft: boolean): Promise<void> {
  const session = await requireSession()
  const sug = await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId), with: { template: true } })
  if (!sug || sug.status !== 'open') return
  const can =
    session.userId === sug.authorId ||
    session.userId === sug.template.ownerId ||
    (await isCollaborator(sug.template.id, session.userId))
  if (!can) return
  await db.update(suggestions).set({ draft }).where(eq(suggestions.id, sug.id))
  await revalidateSuggestion(sug.template.ownerId, sug.template.slug, sug.number ?? sug.id)
}

/**
 * Попросить/перестать просить ревью у пользователя (переключатель, как исполнители).
 *
 * Просьба — не вердикт: она живёт в своей таблице и снимается ВРУЧНУЮ, даже если
 * человек уже отревьюил. Иначе «просили и он ответил» было бы не отличить от
 * «никто не просил», а именно это отличие делает список рецензентов полезным.
 */
export async function toggleReviewRequest(suggestionId: string, handle: string): Promise<void> {
  const loaded = await loadForManage(suggestionId)
  const session = loaded?.session ?? (await requireSession())
  const sug =
    loaded?.sug ?? (await db.query.suggestions.findFirst({ where: (s) => eq(s.id, suggestionId), with: { template: true } }))
  if (!sug) return
  // Автор своей правки тоже может просить ревью — иначе просить было бы некому.
  if (!loaded && session.userId !== sug.authorId) return

  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.handle, handle)).limit(1)
  if (!u) return
  const [existing] = await db
    .select({ id: suggestionReviewRequests.id })
    .from(suggestionReviewRequests)
    .where(and(eq(suggestionReviewRequests.suggestionId, sug.id), eq(suggestionReviewRequests.userId, u.id)))
    .limit(1)
  if (existing) {
    await db.delete(suggestionReviewRequests).where(eq(suggestionReviewRequests.id, existing.id))
  } else {
    await db.insert(suggestionReviewRequests).values({ suggestionId: sug.id, userId: u.id, requestedById: session.userId })
    // Гном — такой же рецензент, но его просьбу можно исполнить: ставим задачу,
    // и вердикт приходит фоном в ту же таблицу, что у людей. Ради этого гномы и
    // заведены настоящими пользователями.
    const [expert] = await db
      .select({ id: councilExperts.id })
      .from(councilExperts)
      .where(eq(councilExperts.userId, u.id))
      .limit(1)
    if (expert) {
      await enqueueJob('gnome_review', { suggestionId: sug.id, expertId: expert.id, lang: await getLang() }).catch(() => {})
    }
    await notify({
      recipientId: u.id,
      actorId: session.userId,
      type: 'review_requested',
      templateId: sug.templateId,
      suggestionId: sug.id,
    })
  }
  await revalidateSuggestion(sug.template.ownerId, sug.template.slug, sug.number ?? sug.id)
}
