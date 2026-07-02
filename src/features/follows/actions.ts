'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { db, follows, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { notify } from '@/features/notifications/notify'

/** Подписаться / отписаться от пользователя. */
export async function toggleFollow(targetUserId: string): Promise<void> {
  const session = await requireSession()
  if (session.userId === targetUserId) return

  const existing = await db
    .select({ id: follows.id })
    .from(follows)
    .where(and(eq(follows.followerId, session.userId), eq(follows.followingId, targetUserId)))
    .limit(1)

  if (existing.length) {
    await db
      .delete(follows)
      .where(and(eq(follows.followerId, session.userId), eq(follows.followingId, targetUserId)))
  } else {
    await db.insert(follows).values({ followerId: session.userId, followingId: targetUserId })
    await notify({ recipientId: targetUserId, actorId: session.userId, type: 'follow' })
  }

  const [target] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, targetUserId)).limit(1)
  if (target) revalidatePath(`/${target.handle}`)
}
