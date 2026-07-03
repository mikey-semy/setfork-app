import 'server-only'
import { getSession, type SessionUser } from './session'

/** Админ определяется ником из env ADMIN_HANDLES (через запятую). */
export function isAdminHandle(handle: string | null | undefined): boolean {
  if (!handle) return false
  const h = handle.toLowerCase()
  // Общий demo-аккаунт НИКОГДА не админ в проде: demo-вход публичен (dev-фолбэк без
  // GitHub OAuth), иначе любой кликнувший «demo» получил бы полные права админа.
  if (h === 'demo' && process.env.NODE_ENV === 'production') return false
  const list = (process.env.ADMIN_HANDLES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return list.includes(h)
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
