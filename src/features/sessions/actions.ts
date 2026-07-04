'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, ne } from 'drizzle-orm'
import { db, sessions } from '@/shared/db'
import { clearSessionCookie, requireSession } from '@/shared/auth/session'
import { recordAudit } from '@/shared/audit'

/** Отозвать одну сессию (свою). Если текущую — заодно чистим cookie. */
export async function revokeSession(sid: string): Promise<void> {
  const session = await requireSession()
  await db.delete(sessions).where(and(eq(sessions.id, sid), eq(sessions.userId, session.userId)))
  await recordAudit('session.revoke', { actorId: session.userId, targetType: 'session', targetId: sid })
  if (sid === session.sid) {
    await clearSessionCookie()
    const { redirect } = await import('next/navigation')
    redirect('/login')
  }
  revalidatePath('/settings')
}

/** Выйти со всех устройств, кроме текущего. */
export async function revokeOtherSessions(): Promise<void> {
  const session = await requireSession()
  await db.delete(sessions).where(and(eq(sessions.userId, session.userId), ne(sessions.id, session.sid ?? '')))
  await recordAudit('session.revoke_others', { actorId: session.userId, targetType: 'session' })
  revalidatePath('/settings')
}
