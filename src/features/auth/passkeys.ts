'use server'

import { and, desc, eq, sql } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { db, passkeys, users } from '@/shared/db'
import { requireSession, startSession } from '@/shared/auth/session'
import { clientIpFromHeaders } from '@/shared/auth/app-origin'
import { b64uFromBytes, bytesFromB64u, expectedOrigin, RP_NAME, rpID } from '@/shared/auth/webauthn'
import { rateLimit } from '@/shared/rate-limit'
import { recordAudit } from '@/shared/audit'
import { avatarSrc } from '@/shared/media'

// Беспарольный вход по passkey (WebAuthn). Криптографию делает
// @simplewebauthn/server; здесь — челлендж в короткоживущей подписанной куке
// (как enroll в twofa) + хранение публичного ключа и counter (anti-replay).

const CHALLENGE_COOKIE = 'sf-pk-challenge'
const TTL_SEC = 5 * 60

function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET
  if (!s) throw new Error('AUTH_SECRET is not set')
  return new TextEncoder().encode(s)
}
async function setChallenge(purpose: 'reg' | 'auth', challenge: string): Promise<void> {
  const token = await new SignJWT({ challenge, purpose }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${TTL_SEC}s`).sign(secretKey())
  const c = await cookies()
  c.set(CHALLENGE_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: TTL_SEC })
}
async function readChallenge(purpose: 'reg' | 'auth'): Promise<string | null> {
  const c = await cookies()
  const raw = c.get(CHALLENGE_COOKIE)?.value
  if (!raw) return null
  try {
    const { payload } = await jwtVerify(raw, secretKey())
    return payload.purpose === purpose && typeof payload.challenge === 'string' ? payload.challenge : null
  } catch {
    return null
  }
}
async function clearChallenge(): Promise<void> {
  ;(await cookies()).delete(CHALLENGE_COOKIE)
}

// ── Регистрация passkey (в настройках, под сессией) ──────────────────
export async function beginPasskeyRegistration() {
  const session = await requireSession()
  const existing = await db.select({ credentialId: passkeys.credentialId, transports: passkeys.transports }).from(passkeys).where(eq(passkeys.userId, session.userId))
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpID(),
    userName: session.handle,
    userID: new TextEncoder().encode(session.userId),
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports ? (p.transports.split(',') as never) : undefined })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  })
  await setChallenge('reg', options.challenge)
  return options
}

export type PasskeyResult = { ok: true } | { error: string }

export async function finishPasskeyRegistration(response: RegistrationResponseJSON, name: string): Promise<PasskeyResult> {
  const session = await requireSession()
  const expectedChallenge = await readChallenge('reg')
  if (!expectedChallenge) return { error: 'expired' }
  let verification
  try {
    verification = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: expectedOrigin(), expectedRPID: rpID() })
  } catch {
    return { error: 'verify' }
  }
  if (!verification.verified || !verification.registrationInfo) return { error: 'verify' }
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo
  try {
    await db.insert(passkeys).values({
      userId: session.userId,
      credentialId: credential.id,
      publicKey: b64uFromBytes(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports?.join(',') ?? null,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name: name.trim().slice(0, 40) || 'Passkey',
    })
  } catch {
    return { error: 'exists' } // credential_id unique — passkey уже зарегистрирован
  }
  await clearChallenge()
  await recordAudit('passkey.add', { actorId: session.userId })
  return { ok: true }
}

// ── Вход по passkey (без сессии) ─────────────────────────────────────
export async function beginPasskeyLogin() {
  const options = await generateAuthenticationOptions({ rpID: rpID(), userVerification: 'preferred' })
  await setChallenge('auth', options.challenge)
  return options
}

export async function finishPasskeyLogin(response: AuthenticationResponseJSON): Promise<PasskeyResult> {
  const ip = await clientIpFromHeaders()
  if (!rateLimit(`pklogin:${ip}`, 10, 5 * 60_000).ok) return { error: 'throttled' }
  const expectedChallenge = await readChallenge('auth')
  if (!expectedChallenge) return { error: 'expired' }
  const [pk] = await db.select().from(passkeys).where(eq(passkeys.credentialId, response.id)).limit(1)
  if (!pk) return { error: 'unknown' }
  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: expectedOrigin(),
      expectedRPID: rpID(),
      credential: { id: pk.credentialId, publicKey: bytesFromB64u(pk.publicKey), counter: pk.counter, transports: pk.transports ? (pk.transports.split(',') as never) : undefined },
    })
  } catch {
    return { error: 'verify' }
  }
  if (!verification.verified) return { error: 'verify' }
  // counter (anti-replay) двигаем атомарно только вперёд.
  await db.update(passkeys).set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() }).where(eq(passkeys.id, pk.id))
  await clearChallenge()

  const [user] = await db.select().from(users).where(eq(users.id, pk.userId)).limit(1)
  if (!user) return { error: 'unknown' }
  await startSession({ userId: user.id, handle: user.handle, name: user.name ?? undefined, avatarUrl: (await avatarSrc(user.avatarUrl, 64)) ?? undefined })
  await recordAudit('passkey.login', { actorId: user.id })
  return { ok: true }
}

// ── Управление (настройки) ───────────────────────────────────────────
export async function listPasskeys() {
  const session = await requireSession()
  return db
    .select({ id: passkeys.id, name: passkeys.name, createdAt: passkeys.createdAt, lastUsedAt: passkeys.lastUsedAt })
    .from(passkeys)
    .where(eq(passkeys.userId, session.userId))
    .orderBy(desc(passkeys.createdAt))
}

export async function deletePasskey(id: string): Promise<void> {
  const session = await requireSession()
  await db.delete(passkeys).where(and(eq(passkeys.id, id), eq(passkeys.userId, session.userId)))
  await recordAudit('passkey.remove', { actorId: session.userId })
}

export async function renamePasskey(id: string, name: string): Promise<void> {
  const session = await requireSession()
  await db.update(passkeys).set({ name: name.trim().slice(0, 40) || 'Passkey' }).where(and(eq(passkeys.id, id), eq(passkeys.userId, session.userId)))
}

/** Есть ли у пользователя passkeys (для подсказок в UI). */
export async function hasPasskeys(userId: string): Promise<boolean> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(passkeys).where(eq(passkeys.userId, userId))
  return (r?.n ?? 0) > 0
}
