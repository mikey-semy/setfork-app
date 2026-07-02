'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, templates, users, watches } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'

/** Тихо подписать пользователя на список (идемпотентно). Для авто-watch. */
export async function ensureWatch(userId: string, templateId: string): Promise<void> {
  try {
    await db.insert(watches).values({ userId, templateId }).onConflictDoNothing()
  } catch {
    /* watch — не критичный путь */
  }
}

/** Подписаться/отписаться (кнопка Watch). */
export async function toggleWatch(templateId: string): Promise<void> {
  const session = await requireSession()
  const [existing] = await db
    .select({ id: watches.id })
    .from(watches)
    .where(and(eq(watches.userId, session.userId), eq(watches.templateId, templateId)))
    .limit(1)
  if (existing) {
    await db.delete(watches).where(and(eq(watches.userId, session.userId), eq(watches.templateId, templateId)))
  } else {
    await db.insert(watches).values({ userId: session.userId, templateId }).onConflictDoNothing()
  }
  const [t] = await db.select({ ownerId: templates.ownerId, slug: templates.slug }).from(templates).where(eq(templates.id, templateId))
  if (t) {
    const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, t.ownerId))
    if (u) revalidatePath(`/${u.handle}/${t.slug}`)
  }
}
