'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, templates, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { canViewList, type WatchEvents, type WatchLevel } from '@/core'
import { curationStore } from '@/features/curation/store'

/** Тихо подписать ТЕКУЩЕГО пользователя на список (идемпотентно). Для авто-watch
 *  из других действий (открыл issue/тред/правку → следишь за списком). userId
 *  берём из сессии, а не из аргумента: это 'use server'-эндпоинт, произвольный
 *  userId дал бы аноним-вектор «подписать любого» (react-doctor). */
export async function ensureWatch(templateId: string): Promise<void> {
  const session = await requireSession()
  await curationStore.ensureWatch(templateId, session.userId)
}

/** Подписаться/отписаться (кнопка Watch). */
export async function toggleWatch(templateId: string): Promise<void> {
  const session = await requireSession()
  const [t] = await db
    .select({ ownerId: templates.ownerId, slug: templates.slug, visibility: templates.visibility, status: templates.status, moderation: templates.moderation })
    .from(templates)
    .where(eq(templates.id, templateId))
  if (!t) return
  // Нельзя следить за невидимым списком (приватный/скрытый) — иначе watcher получает
  // new_version-уведомления о правках владельца = оракул активности приватного контента.
  if (!canViewList(t, { isOwner: t.ownerId === session.userId })) return
  await curationStore.toggleWatch(templateId, session.userId)
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, t.ownerId))
  if (u) revalidatePath(`/${u.handle}/${t.slug}`)
}

/** Задать уровень подписки (дропдаун Watch: Participating & @mentions / All activity /
 *  Ignore / Custom). events — набор событий только для level='custom'. */
export async function setWatch(templateId: string, level: WatchLevel, events?: WatchEvents): Promise<void> {
  const session = await requireSession()
  const [t] = await db
    .select({ ownerId: templates.ownerId, slug: templates.slug, visibility: templates.visibility, status: templates.status, moderation: templates.moderation })
    .from(templates)
    .where(eq(templates.id, templateId))
  if (!t) return
  // Тот же гейт видимости, что у toggleWatch: за невидимым списком следить нельзя.
  if (!canViewList(t, { isOwner: t.ownerId === session.userId })) return
  await curationStore.setWatch(templateId, session.userId, level, events)
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, t.ownerId))
  if (u) revalidatePath(`/${u.handle}/${t.slug}`)
}
