'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, milestones, suggestionAssignees, suggestions, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
// eslint-disable-next-line boundaries/dependencies -- права коллаборатора из collab
import { isCollaborator } from '@/features/collab/queries'
// eslint-disable-next-line boundaries/dependencies -- ОДНО правило ярлыков на задачи и правки
import { cleanLabels } from '@/features/issues/labels'
// eslint-disable-next-line boundaries/dependencies -- набор кастомных метоk списка
import { getListLabels } from '@/features/issues/queries'

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
