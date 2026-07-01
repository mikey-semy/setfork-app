// Сессионный JWT + cookie на jose. HTTP-only, Secure в prod, SameSite=Lax, 30 дней.
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'

const COOKIE_NAME = 'sethub_session'
const SESSION_DURATION_DAYS = 30

export interface SessionUser {
  userId: string
  handle: string
  name?: string
  avatarUrl?: string
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not set')
  return new TextEncoder().encode(secret)
}

export async function encodeSession(payload: SessionUser): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_DAYS}d`)
    .sign(getSecret())
}

export async function setSessionCookie(payload: SessionUser): Promise<void> {
  const token = await encodeSession(payload)
  const c = await cookies()
  c.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DURATION_DAYS * 24 * 3600,
  })
}

export async function getSession(): Promise<SessionUser | null> {
  const c = await cookies()
  const token = c.get(COOKIE_NAME)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecret())
    return {
      userId: payload.userId as string,
      handle: payload.handle as string,
      name: payload.name as string | undefined,
      avatarUrl: payload.avatarUrl as string | undefined,
    }
  } catch {
    return null
  }
}

export async function clearSessionCookie(): Promise<void> {
  const c = await cookies()
  c.delete(COOKIE_NAME)
}

/** Сессия или redirect('/login') — для server components и actions. */
export async function requireSession(): Promise<SessionUser> {
  const s = await getSession()
  if (!s) {
    const { redirect } = await import('next/navigation')
    redirect('/login')
  }
  return s!
}
