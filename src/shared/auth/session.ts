// Серверный реестр сессий: JWT-cookie хранит sid, а сама сессия живёт в таблице
// sessions — это даёт отзыв («выйти отовсюду») и presence («кто онлайн»).
import { cookies, headers } from 'next/headers'
import { cache } from 'react'
import { SignJWT, jwtVerify } from 'jose'
import { eq } from 'drizzle-orm'
import { db, sessions } from '@/shared/db'

const COOKIE_NAME = 'setfork_session'
const SESSION_DURATION_DAYS = 30
const LASTSEEN_THROTTLE_MS = 60_000

export interface SessionUser {
  userId: string
  handle: string
  name?: string
  avatarUrl?: string
  sid?: string // id строки в sessions
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not set')
  return new TextEncoder().encode(secret)
}

async function signCookie(payload: SessionUser): Promise<void> {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_DAYS}d`)
    .sign(getSecret())
  const c = await cookies()
  c.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DURATION_DAYS * 24 * 3600,
  })
}

/** Новый вход: создаёт строку в sessions (устройство/IP) и ставит cookie с sid. */
export async function startSession(payload: SessionUser): Promise<void> {
  const h = await headers()
  const userAgent = h.get('user-agent') ?? null
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || null
  const [row] = await db.insert(sessions).values({ userId: payload.userId, userAgent, ip }).returning({ id: sessions.id })
  await signCookie({ ...payload, sid: row.id })
}

/** Обновить cookie (имя/аватар), сохранив тот же sid. Для правок профиля. */
export async function refreshSessionCookie(payload: SessionUser): Promise<void> {
  const current = await getSession()
  await signCookie({ ...payload, sid: current?.sid })
}

/** Сессия из cookie + проверка, что строка в sessions ещё жива (иначе отозвана). */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const c = await cookies()
  const token = c.get(COOKIE_NAME)?.value
  if (!token) return null
  let payload: SessionUser
  try {
    const { payload: p } = await jwtVerify(token, getSecret())
    payload = {
      userId: p.userId as string,
      handle: p.handle as string,
      name: p.name as string | undefined,
      avatarUrl: p.avatarUrl as string | undefined,
      sid: p.sid as string | undefined,
    }
  } catch {
    return null
  }
  if (!payload.sid) return null // старый cookie без sid → считаем разлогиненным
  const [row] = await db.select({ lastSeenAt: sessions.lastSeenAt }).from(sessions).where(eq(sessions.id, payload.sid)).limit(1)
  if (!row) return null // сессия отозвана/удалена
  if (Date.now() - new Date(row.lastSeenAt).getTime() > LASTSEEN_THROTTLE_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, payload.sid)).catch(() => {})
  }
  return payload
})

/** Выход: удаляет строку сессии и чистит cookie. */
export async function clearSessionCookie(): Promise<void> {
  const c = await cookies()
  const token = c.get(COOKIE_NAME)?.value
  if (token) {
    try {
      const { payload } = await jwtVerify(token, getSecret())
      if (payload.sid) await db.delete(sessions).where(eq(sessions.id, payload.sid as string))
    } catch {
      /* игнор */
    }
  }
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
