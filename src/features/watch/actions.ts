'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, templates, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { canViewList, type WatchEvents, type WatchLevel } from '@/core'
import { curationStore } from '@/features/curation/store'
// eslint-disable-next-line boundaries/dependencies -- права коллаборатора из collab (тот же кросс-фич-паттерн, что в library/review-actions.ts)
import { isCollaborator } from '@/features/collab/queries'

/** Список для гейта видимости + ник владельца для revalidate. */
async function listForWatch(templateId: string) {
  const [t] = await db
    .select({
      id: templates.id,
      ownerId: templates.ownerId,
      slug: templates.slug,
      visibility: templates.visibility,
      status: templates.status,
      moderation: templates.moderation,
    })
    .from(templates)
    .where(eq(templates.id, templateId))
  return t
}

/**
 * Может ли зритель следить за списком. Нельзя следить за невидимым (приватный/
 * черновик/скрытый): watcher получал бы new_version-уведомления о правках владельца —
 * оракул активности приватного контента. Коллаборатор — «свой»: список ведут вместе.
 * Спрашиваем его только когда без него не проходит, чтобы не платить запросом на
 * каждый публичный список.
 */
async function canWatch(t: NonNullable<Awaited<ReturnType<typeof listForWatch>>>, userId: string): Promise<boolean> {
  const isOwner = t.ownerId === userId
  if (canViewList(t, { isOwner })) return true
  return canViewList(t, { isOwner, isCollaborator: await isCollaborator(t.id, userId) })
}

/** Тихо подписать ТЕКУЩЕГО пользователя на список (идемпотентно). Для авто-watch
 *  из других действий (открыл issue/тред/правку → следишь за списком). userId
 *  берём из сессии, а не из аргумента: это 'use server'-эндпоинт, произвольный
 *  userId дал бы аноним-вектор «подписать любого» (react-doctor). */
export async function ensureWatch(templateId: string): Promise<void> {
  const session = await requireSession()
  const t = await listForWatch(templateId)
  if (!t) return
  // Гейт видимости — тот же, что у кнопки Watch. Это ТОЖЕ сетевая точка входа
  // (экспорт из 'use server'-файла), а не только внутренний помощник: без проверки
  // любой залогиненный подписывался на любой список по id и получал уведомления о
  // приватном — заголовок, адрес и ритм работы (линза 02, F8).
  if (!(await canWatch(t, session.userId))) return
  await curationStore.ensureWatch(templateId, session.userId)
}

/** Подписаться/отписаться (кнопка Watch). */
export async function toggleWatch(templateId: string): Promise<void> {
  const session = await requireSession()
  const t = await listForWatch(templateId)
  if (!t) return
  if (!(await canWatch(t, session.userId))) return
  await curationStore.toggleWatch(templateId, session.userId)
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, t.ownerId))
  if (u) revalidatePath(`/${u.handle}/${t.slug}`)
}

/** Задать уровень подписки (дропдаун Watch: Participating & @mentions / All activity /
 *  Ignore / Custom). events — набор событий только для level='custom'. */
export async function setWatch(templateId: string, level: WatchLevel, events?: WatchEvents): Promise<void> {
  const session = await requireSession()
  const t = await listForWatch(templateId)
  if (!t) return
  if (!(await canWatch(t, session.userId))) return
  await curationStore.setWatch(templateId, session.userId, level, events)
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, t.ownerId))
  if (u) revalidatePath(`/${u.handle}/${t.slug}`)
}
