import 'server-only'
import { getSession, type SessionUser } from './session'

// Чистый предикат живёт в admin-handle.ts (без next/headers — его импортит middleware).
export { isAdminHandle } from './admin-handle'
import { isAdminHandle } from './admin-handle'

export async function getAdmin(): Promise<SessionUser | null> {
  const s = await getSession()
  return s && isAdminHandle(s.handle) ? s : null
}

export async function requireAdmin(): Promise<SessionUser> {
  const s = await getAdmin()
  if (!s) {
    const { redirect } = await import('next/navigation')
    redirect('/')
  }
  return s!
}
