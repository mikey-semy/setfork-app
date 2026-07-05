'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, templates, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { curationStore } from '@/features/curation/store'

/** Тихо подписать пользователя на список (идемпотентно). Для авто-watch. */
export async function ensureWatch(userId: string, templateId: string): Promise<void> {
  await curationStore.ensureWatch(templateId, userId)
}

/** Подписаться/отписаться (кнопка Watch). */
export async function toggleWatch(templateId: string): Promise<void> {
  const session = await requireSession()
  await curationStore.toggleWatch(templateId, session.userId)
  const [t] = await db.select({ ownerId: templates.ownerId, slug: templates.slug }).from(templates).where(eq(templates.id, templateId))
  if (t) {
    const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, t.ownerId))
    if (u) revalidatePath(`/${u.handle}/${t.slug}`)
  }
}
