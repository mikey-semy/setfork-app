'use server'

import { and, eq, isNull } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { SignJWT, jwtVerify } from 'jose'
import QRCode from 'qrcode'
import { db, recoveryCodes, users } from '@/shared/db'
import { requireSession, startSession } from '@/shared/auth/session'
import { recordAudit } from '@/shared/audit'
import { avatarSrc } from '@/shared/media'
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from '@/shared/auth/totp'

// 2FA-флоу. Промежуточные состояния — короткоживущие подписанные куки
// (JWT на AUTH_SECRET): enroll-секрет до подтверждения и pending-логин.

const ENROLL_COOKIE = 'sf-2fa-enroll'
const PENDING_COOKIE = 'sf-2fa-pending'
const TTL_SEC = 5 * 60

function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET
  if (!s) throw new Error('AUTH_SECRET is not set')
  return new TextEncoder().encode(s)
}

async function setSigned(name: string, payload: Record<string, string>): Promise<void> {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SEC}s`)
    .sign(secretKey())
  const c = await cookies()
  c.set(name, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: TTL_SEC })
}

async function readSigned(name: string): Promise<Record<string, string> | null> {
  const c = await cookies()
  const raw = c.get(name)?.value
  if (!raw) return null
  try {
    const { payload } = await jwtVerify(raw, secretKey())
    return payload as Record<string, string>
  } catch {
    return null
  }
}

async function clearCookie(name: string): Promise<void> {
  const c = await cookies()
  c.delete(name)
}

// ── Включение (настройки) ────────────────────────────────────────────
export interface EnrollStart {
  qrDataUrl: string
  secret: string // для ручного ввода
}

export async function beginTotpEnroll(): Promise<EnrollStart> {
  const session = await requireSession()
  const secret = generateTotpSecret()
  await setSigned(ENROLL_COOKIE, { uid: session.userId, secret })
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl(session.handle, secret), { margin: 1, width: 220 })
  return { qrDataUrl, secret }
}

export type TwoFaResult = { ok: true; recovery?: string[] } | { ok: false; error: 'bad-code' | 'expired' | 'no-password' }

export async function confirmTotpEnroll(code: string): Promise<TwoFaResult> {
  const session = await requireSession()
  const pending = await readSigned(ENROLL_COOKIE)
  if (!pending || pending.uid !== session.userId || !pending.secret) return { ok: false, error: 'expired' }
  if (!verifyTotp(pending.secret, code)) return { ok: false, error: 'bad-code' }

  const codes = generateRecoveryCodes()
  await db.transaction(async (tx) => {
    await tx.update(users).set({ totpSecret: encryptSecret(pending.secret), totpEnabled: true }).where(eq(users.id, session.userId))
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, session.userId))
    await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId: session.userId, codeHash: hashRecoveryCode(c) })))
  })
  await clearCookie(ENROLL_COOKIE)
  await recordAudit('2fa.enable', { actorId: session.userId })
  revalidatePath('/settings')
  return { ok: true, recovery: codes }
}

/** Проверка кода владельца: TOTP или неиспользованный recovery (помечается used). */
async function checkUserCode(userId: string, code: string): Promise<boolean> {
  const [u] = await db.select({ secret: users.totpSecret, enabled: users.totpEnabled }).from(users).where(eq(users.id, userId)).limit(1)
  if (!u?.enabled || !u.secret) return false
  const secret = decryptSecret(u.secret)
  if (secret && verifyTotp(secret, code)) return true
  // recovery-код (формат xxxxx-xxxxx)
  const hash = hashRecoveryCode(code)
  const [rc] = await db
    .select({ id: recoveryCodes.id })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, hash), isNull(recoveryCodes.usedAt)))
    .limit(1)
  if (!rc) return false
  await db.update(recoveryCodes).set({ usedAt: new Date() }).where(eq(recoveryCodes.id, rc.id))
  return true
}

export async function disableTotp(code: string): Promise<TwoFaResult> {
  const session = await requireSession()
  if (!(await checkUserCode(session.userId, code))) return { ok: false, error: 'bad-code' }
  await db.transaction(async (tx) => {
    await tx.update(users).set({ totpSecret: null, totpEnabled: false }).where(eq(users.id, session.userId))
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, session.userId))
  })
  await recordAudit('2fa.disable', { actorId: session.userId })
  revalidatePath('/settings')
  return { ok: true }
}

export async function regenerateRecoveryCodes(code: string): Promise<TwoFaResult> {
  const session = await requireSession()
  if (!(await checkUserCode(session.userId, code))) return { ok: false, error: 'bad-code' }
  const codes = generateRecoveryCodes()
  await db.transaction(async (tx) => {
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, session.userId))
    await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId: session.userId, codeHash: hashRecoveryCode(c) })))
  })
  await recordAudit('2fa.recovery-regenerate', { actorId: session.userId })
  return { ok: true, recovery: codes }
}

// ── Шаг логина ───────────────────────────────────────────────────────
/** Пароль верен, но включён 2FA → ставим pending-куку и ведём на /login/2fa. */
export async function startPendingLogin(userId: string): Promise<void> {
  await setSigned(PENDING_COOKIE, { uid: userId })
}

export async function verify2faLogin(_prev: { error?: string } | null, formData: FormData): Promise<{ error?: string }> {
  const code = String(formData.get('code') ?? '').trim()
  const pending = await readSigned(PENDING_COOKIE)
  if (!pending?.uid) redirect('/login')
  if (!(await checkUserCode(pending.uid, code))) return { error: 'bad-code' }

  const [user] = await db.select().from(users).where(eq(users.id, pending.uid)).limit(1)
  if (!user) redirect('/login')
  await clearCookie(PENDING_COOKIE)
  await startSession({
    userId: user.id,
    handle: user.handle,
    name: user.name ?? undefined,
    avatarUrl: (await avatarSrc(user.avatarUrl, 64)) ?? undefined,
  })
  redirect('/')
}

/** Есть ли живой pending (для guard страницы /login/2fa). */
export async function hasPendingLogin(): Promise<boolean> {
  return !!(await readSigned(PENDING_COOKIE))?.uid
}
