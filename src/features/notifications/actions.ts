'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { db, notifications } from '@/shared/db'
import { getSession } from '@/shared/auth/session'

/** Пометить все уведомления пользователя прочитанными. */
export async function markNotificationsRead(): Promise<void> {
  const session = await getSession()
  if (!session) return
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.recipientId, session.userId), eq(notifications.read, false)))
  revalidatePath('/', 'layout')
}
