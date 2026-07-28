import 'server-only'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'

/**
 * Короткоживущие подписанные куки 2FA — и постановка pending-логина.
 *
 * Модуль БЕЗ 'use server' намеренно. `startPendingLogin(userId)` ставит куку «этот
 * пользователь прошёл пароль», а личность приходит аргументом. Экспортом из
 * экшен-файла это была бы сетевая точка входа: любой клиент ставил бы себе pending
 * на ЧУЖОЙ id, не зная пароля, и от входа под чужим аккаунтом его отделял бы только
 * шестизначный код. Пароль в этой цепочке переставал бы участвовать вовсе.
 *
 * Здесь функция обычная: её зовёт сервер — экшен логина после проверки пароля и
 * завершение OAuth после проверки провайдером.
 */

export const ENROLL_COOKIE = 'sf-2fa-enroll'
export const PENDING_COOKIE = 'sf-2fa-pending'
const TTL_SEC = 5 * 60

function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET
  if (!s) throw new Error('AUTH_SECRET is not set')
  return new TextEncoder().encode(s)
}

// purpose в клейме привязывает токен к назначению — исключает подмену enroll↔pending
// (и любых будущих потребителей), даже если совпадёт имя куки.
export async function setSigned(name: string, purpose: string, payload: Record<string, string>): Promise<void> {
  const token = await new SignJWT({ ...payload, purpose })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SEC}s`)
    .sign(secretKey())
  const c = await cookies()
  c.set(name, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: TTL_SEC })
}

export async function readSigned(name: string, purpose: string): Promise<Record<string, string> | null> {
  const c = await cookies()
  const raw = c.get(name)?.value
  if (!raw) return null
  try {
    const { payload } = await jwtVerify(raw, secretKey())
    return payload.purpose === purpose ? (payload as Record<string, string>) : null
  } catch {
    return null
  }
}

export async function clearCookie(name: string): Promise<void> {
  const c = await cookies()
  c.delete(name)
}

/** Пароль верен, но включён 2FA → ставим pending-куку и ведём на /login/2fa. */
export async function startPendingLogin(userId: string): Promise<void> {
  await setSigned(PENDING_COOKIE, 'pending', { uid: userId })
}
