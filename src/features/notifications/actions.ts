'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { db, notifications, users } from '@/shared/db'
import type { NotifyPrefs } from '@/shared/db/schema'
import { getSession, requireSession } from '@/shared/auth/session'

/** Сохранить предпочтения уведомлений (какие типы получать). */
export async function updateNotifyPrefs(formData: FormData): Promise<void> {
  const session = await requireSession()
  const on = (k: string) => formData.get(k) === 'on'
  const prefs: NotifyPrefs = {
    newSuggestions: on('newSuggestions'),
    suggestionResolved: on('suggestionResolved'),
    stars: on('stars'),
    forks: on('forks'),
    issues: on('issues'),
    comments: on('comments'),
    watchedUpdates: on('watchedUpdates'),
    email: on('email'),
    browser: on('browser'),
  }
  await db.update(users).set({ notifyPrefs: prefs }).where(eq(users.id, session.userId))
  revalidatePath('/settings')
}

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
