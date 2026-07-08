'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, templates, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { canViewList } from '@/features/library/access'
import { curationStore } from '@/features/curation/store'

/** Тихо подписать пользователя на список (идемпотентно). Для авто-watch. */
export async function ensureWatch(userId: string, templateId: string): Promise<void> {
  await curationStore.ensureWatch(templateId, userId)
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
