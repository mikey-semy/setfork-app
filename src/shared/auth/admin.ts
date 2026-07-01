import 'server-only'
import { getSession, type SessionUser } from './session'

/** Админ определяется ником из env ADMIN_HANDLES (через запятую). */
export function isAdminHandle(handle: string | null | undefined): boolean {
  const list = (process.env.ADMIN_HANDLES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return !!handle && list.includes(handle.toLowerCase())
}

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
