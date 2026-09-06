'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import type { WatchEvents, WatchLevel } from '@/core'
import { curationStore } from '@/features/curation/store'
import { canWatch, listForWatch, subscribeToList } from './subscribe'

/**
 * Тихо подписать ТЕКУЩЕГО пользователя на список (идемпотентно). Для авто-watch из
 * других действий (открыл issue/тред/правку → следишь за списком).
 *
 * userId берём из сессии, а не из аргумента: это 'use server'-эндпоинт, произвольный
 * userId дал бы аноним-вектор «подписать любого» (react-doctor). Само действие живёт в
 * `./subscribe` — оттуда его зовут пути без cookie-сессии (MCP).
 */
export async function ensureWatch(templateId: string): Promise<void> {
  const session = await requireSession()
  await subscribeToList(templateId, session.userId)
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
