'use server'

import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { SignJWT, jwtVerify } from 'jose'
import { db, sessions, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { hashPassword } from '@/shared/auth/password'
import { sendMail } from '@/shared/email/mailer'
import { recordAudit } from '@/shared/audit'
import { getLang } from '@/shared/i18n/server'

// Верификация почты и сброс пароля. Токены — подписанные JWT в ссылке
// (БД-токены не нужны): verify 24ч; reset 1ч + хвост password_hash в
// клейме — после смены пароля старые reset-ссылки умирают сами.

function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET
  if (!s) throw new Error('AUTH_SECRET is not set')
  return new TextEncoder().encode(s)
}

async function origin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

async function signToken(payload: Record<string, string>, ttl: string): Promise<string> {
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(ttl).sign(secretKey())
}

async function readToken(token: string): Promise<Record<string, string> | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey())
    return payload as Record<string, string>
  } catch {
    return null
  }
}

const button = (href: string, label: string) =>
  `<p style="margin:20px 0"><a href="${href}" style="background:#1c1c1a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${label}</a></p><p style="color:#6b6b66;font-size:13px">${href}</p>`

// ── Верификация почты ────────────────────────────────────────────────
export async function sendVerificationEmail(userId: string): Promise<boolean> {
  const [u] = await db.select({ email: users.email, handle: users.handle, verified: users.emailVerifiedAt }).from(users).where(eq(users.id, userId)).limit(1)
  if (!u?.email || u.verified) return false
  const lang = await getLang()
  const ru = lang === 'ru'
  const token = await signToken({ uid: userId, email: u.email, purpose: 'verify-email' }, '24h')
  const link = `${await origin()}/verify-email?token=${encodeURIComponent(token)}`
  return sendMail({
    to: u.email,
    subject: ru ? 'Подтверди почту — SetFork' : 'Verify your email — SetFork',
    html: `<p>${ru ? `Привет, ${u.handle}! Подтверди адрес почты для аккаунта SetFork.` : `Hi ${u.handle}! Please verify the email address for your SetFork account.`}</p>${button(link, ru ? 'Подтвердить почту' : 'Verify email')}<p style="color:#6b6b66;font-size:13px">${ru ? 'Ссылка действует 24 часа. Если это не ты — просто проигнорируй письмо.' : 'The link is valid for 24 hours. If this wasn’t you, just ignore this email.'}</p>`,
  })
}

export async function resendVerification(): Promise<{ sent: boolean }> {
  const session = await requireSession()
  return { sent: await sendVerificationEmail(session.userId) }
}

export type VerifyOutcome = 'ok' | 'invalid' | 'mismatch'

/** Обработка ссылки из письма (вызывается страницей /verify-email). */
export async function consumeVerifyToken(token: string): Promise<VerifyOutcome> {
  const p = await readToken(token)
  if (!p || p.purpose !== 'verify-email' || !p.uid || !p.email) return 'invalid'
  const [u] = await db.select({ email: users.email, verified: users.emailVerifiedAt }).from(users).where(eq(users.id, p.uid)).limit(1)
  if (!u) return 'invalid'
  if (u.email !== p.email) return 'mismatch' // почту сменили после выпуска ссылки
  if (!u.verified) {
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, p.uid))
    revalidatePath('/settings')
  }
  return 'ok'
}

// ── Сброс пароля ─────────────────────────────────────────────────────
/** Хвост хеша пароля в клейме: смена пароля инвалидирует все старые ссылки. */
const pwTail = (hash: string | null) => (hash ?? 'nopw').slice(-16)

export async function requestPasswordReset(_prev: { done?: boolean } | null, formData: FormData): Promise<{ done: boolean }> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const [u] = await db.select({ id: users.id, handle: users.handle, hash: users.passwordHash }).from(users).where(eq(users.email, email)).limit(1)
  // Ответ всегда одинаковый — не раскрываем существование почты.
  if (u) {
    const lang = await getLang()
    const ru = lang === 'ru'
    const token = await signToken({ uid: u.id, purpose: 'reset-password', pw: pwTail(u.hash) }, '1h')
    const link = `${await origin()}/reset-password?token=${encodeURIComponent(token)}`
    await sendMail({
      to: email,
      subject: ru ? 'Сброс пароля — SetFork' : 'Reset your password — SetFork',
      html: `<p>${ru ? `Запрошен сброс пароля для аккаунта ${u.handle}.` : `A password reset was requested for ${u.handle}.`}</p>${button(link, ru ? 'Задать новый пароль' : 'Set a new password')}<p style="color:#6b6b66;font-size:13px">${ru ? 'Ссылка действует 1 час. Если это не ты — проигнорируй письмо, пароль не изменится.' : 'The link is valid for 1 hour. If this wasn’t you, ignore this email — your password stays the same.'}</p>`,
    })
  }
  return { done: true }
}

/** Токен валиден? (для рендера формы на /reset-password) */
export async function checkResetToken(token: string): Promise<boolean> {
  const p = await readToken(token)
  if (!p || p.purpose !== 'reset-password' || !p.uid) return false
  const [u] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, p.uid)).limit(1)
  return !!u && pwTail(u.hash) === p.pw
}

export async function performPasswordReset(_prev: { error?: string } | null, formData: FormData): Promise<{ error?: string }> {
  const token = String(formData.get('token') ?? '')
  const password = String(formData.get('password') ?? '')
  if (password.length < 8) return { error: 'short' }
  const p = await readToken(token)
  if (!p || p.purpose !== 'reset-password' || !p.uid) return { error: 'invalid' }
  const [u] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, p.uid)).limit(1)
  if (!u || pwTail(u.hash) !== p.pw) return { error: 'invalid' }

  await db.update(users).set({ passwordHash: hashPassword(password) }).where(eq(users.id, p.uid))
  // Безопасность: после сброса выходим со ВСЕХ устройств.
  await db.delete(sessions).where(eq(sessions.userId, p.uid))
  await recordAudit('password.reset', { actorId: p.uid })
  redirect('/login?reset=1')
}
