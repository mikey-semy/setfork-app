import 'server-only'
import { eq } from 'drizzle-orm'
import { db, users } from '@/shared/db'
import { getSession, type SessionUser } from './session'

// Чистый предикат живёт в admin-handle.ts (без next/headers — его импортит middleware).
export { isAdminHandle } from './admin-handle'
import { isAdminHandle } from './admin-handle'

export async function getAdmin(): Promise<SessionUser | null> {
  const s = await getSession()
  if (!s) return null
  // Админство НЕ по handle из JWT (он переиздаётся при смене ника), а по ТЕКУЩЕМУ нику
  // из БД по неизменяемому userId. Вместе с резервом admin-ников (handle.ts — их нельзя
  // занять) это закрывает privesc через самоназначаемый handle (security-скан 2026-07-23, F9).
  const [row] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, s.userId)).limit(1)
  return row && isAdminHandle(row.handle) ? s : null
}

export async function requireAdmin(): Promise<SessionUser> {
  const s = await getAdmin()
  if (!s) {
    const { redirect } = await import('next/navigation')
    redirect('/')
  }
  return s!
}
