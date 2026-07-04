// Серверный реестр сессий: JWT-cookie хранит sid, а сама сессия живёт в таблице
// sessions — это даёт отзыв («выйти отовсюду») и presence («кто онлайн»).
import { cookies, headers } from 'next/headers'
import { cache } from 'react'
import { SignJWT, jwtVerify } from 'jose'
import { and, desc, eq, gte, isNull, lt, notInArray } from 'drizzle-orm'
import { db, sessions } from '@/shared/db'

const COOKIE_NAME = 'setfork_session'
const SESSION_DURATION_DAYS = 30
const SESSION_MAX_AGE_MS = SESSION_DURATION_DAYS * 24 * 3600 * 1000
const LASTSEEN_THROTTLE_MS = 60_000
const MAX_SESSIONS_PER_USER = 40 // жёсткий потолок числа строк на юзера (защита от разрастания)

/** Чистит сессии пользователя: протухшие по неактивности + всё сверх последних N. */
async function pruneStaleSessions(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - SESSION_MAX_AGE_MS)
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.lastSeenAt, cutoff))).catch(() => {})
  // Кап: держим только последние MAX_SESSIONS_PER_USER по активности, остальное удаляем.
  const keep = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.lastSeenAt))
    .limit(MAX_SESSIONS_PER_USER)
  if (keep.length >= MAX_SESSIONS_PER_USER) {
    await db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), notInArray(sessions.id, keep.map((k) => k.id))))
      .catch(() => {})
  }
}

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

/** Вход: переиспользует ЖИВУЮ сессию того же пользователя (повторный вход не плодит
 *  строки), иначе создаёт новую. Попутно чистит протухшие. Ставит cookie с sid. */
export async function startSession(payload: SessionUser): Promise<void> {
  const h = await headers()
  const userAgent = h.get('user-agent') ?? null
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || null

  const current = await getSession()
  if (current?.sid && current.userId === payload.userId) {
    // Тот же пользователь уже вошёл (напр. повторно жмёт demo-вход) → не плодим строку.
    await db.update(sessions).set({ userAgent, ip, lastSeenAt: new Date() }).where(eq(sessions.id, current.sid))
    await pruneStaleSessions(payload.userId)
    await signCookie({ ...payload, sid: current.sid })
    return
  }

  // Свежий вход без cookie: дедуп по устройству — то же (userId, UA, IP) в пределах
  // свежести переиспользуем, а не плодим строку (иначе повторные логины = гора сессий).
  const fresh = new Date(Date.now() - SESSION_MAX_AGE_MS)
  const [same] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, payload.userId),
        userAgent === null ? isNull(sessions.userAgent) : eq(sessions.userAgent, userAgent),
        ip === null ? isNull(sessions.ip) : eq(sessions.ip, ip),
        gte(sessions.lastSeenAt, fresh),
      ),
    )
    .orderBy(desc(sessions.lastSeenAt))
    .limit(1)

  let sid: string
  if (same) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, same.id))
    sid = same.id
  } else {
    const [row] = await db.insert(sessions).values({ userId: payload.userId, userAgent, ip }).returning({ id: sessions.id })
    sid = row.id
  }
  await pruneStaleSessions(payload.userId)
  await signCookie({ ...payload, sid })
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
  const age = Date.now() - new Date(row.lastSeenAt).getTime()
  if (age > SESSION_MAX_AGE_MS) return null // протухла по неактивности (будет вычищена)
  if (age > LASTSEEN_THROTTLE_MS) {
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
