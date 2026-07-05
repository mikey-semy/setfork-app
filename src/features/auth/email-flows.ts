'use server'

import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { SignJWT, jwtVerify } from 'jose'
import { db, sessions, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { hashPassword } from '@/shared/auth/password'
import { appOrigin, clientIpFromHeaders } from '@/shared/auth/app-origin'
import { rateLimit } from '@/shared/rate-limit'
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
  const link = `${appOrigin()}/verify-email?token=${encodeURIComponent(token)}`
  return sendMail({
    to: u.email,
    subject: ru ? 'Подтверди почту — SetFork' : 'Verify your email — SetFork',
    html: `<p>${ru ? `Привет, ${u.handle}! Подтверди адрес почты для аккаунта SetFork.` : `Hi ${u.handle}! Please verify the email address for your SetFork account.`}</p>${button(link, ru ? 'Подтвердить почту' : 'Verify email')}<p style="color:#6b6b66;font-size:13px">${ru ? 'Ссылка действует 24 часа. Если это не ты — просто проигнорируй письмо.' : 'The link is valid for 24 hours. If this wasn’t you, just ignore this email.'}</p>`,
  })
}

export async function resendVerification(): Promise<{ sent: boolean }> {
  const session = await requireSession()
  // Не чаще 3 писем за 10 минут на пользователя (анти-спам SMTP).
  if (!rateLimit(`verifysend:${session.userId}`, 3, 10 * 60_000).ok) return { sent: false }
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

// ── Смена почты ──────────────────────────────────────────────────────
// Подтверждение шлём на НОВЫЙ адрес (доказательство владения); старый адрес
// остаётся активным до подтверждения. Токен привязан к текущей почте (cur):
// если её сменили после выпуска ссылки — ссылка мертва.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type EmailChangeResult =
  | { ok: true }
  | { ok: false; error: 'invalid' | 'same' | 'taken' | 'throttled' | 'no-email' | 'smtp' }

export async function requestEmailChange(_prev: EmailChangeResult | null, formData: FormData): Promise<EmailChangeResult> {
  const session = await requireSession()
  const newEmail = String(formData.get('email') ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(newEmail)) return { ok: false, error: 'invalid' }
  const [u] = await db.select({ email: users.email, handle: users.handle }).from(users).where(eq(users.id, session.userId)).limit(1)
  if (!u?.email) return { ok: false, error: 'no-email' } // github-аккаунт без почты — сменить нечего
  if (u.email === newEmail) return { ok: false, error: 'same' }
  if (!rateLimit(`emailchange:${session.userId}`, 3, 15 * 60_000).ok) return { ok: false, error: 'throttled' }
  // Мягкая проверка занятости; гонку добьёт unique-констрейнт при подтверждении.
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, newEmail)).limit(1)
  if (taken) return { ok: false, error: 'taken' }

  const lang = await getLang()
  const ru = lang === 'ru'
  const token = await signToken({ uid: session.userId, newEmail, cur: u.email, purpose: 'change-email' }, '1h')
  const link = `${appOrigin()}/change-email?token=${encodeURIComponent(token)}`
  const sent = await sendMail({
    to: newEmail,
    subject: ru ? 'Подтверди новый адрес — SetFork' : 'Confirm your new email — SetFork',
    html: `<p>${ru ? `Привет, ${u.handle}! Подтверди этот адрес как новую почту аккаунта SetFork.` : `Hi ${u.handle}! Confirm this address as the new email for your SetFork account.`}</p>${button(link, ru ? 'Подтвердить новый адрес' : 'Confirm new email')}<p style="color:#6b6b66;font-size:13px">${ru ? 'Ссылка действует 1 час. Пока не подтвердишь — вход остаётся на старом адресе.' : 'The link is valid for 1 hour. Until you confirm, sign-in keeps using your old address.'}</p>`,
  })
  if (!sent) return { ok: false, error: 'smtp' }
  // Уведомляем СТАРЫЙ адрес — на случай, если запрос инициирован не владельцем (best-effort).
  await sendMail({
    to: u.email,
    subject: ru ? 'Запрошена смена почты — SetFork' : 'Email change requested — SetFork',
    html: `<p>${ru ? `Для аккаунта ${u.handle} запрошена смена почты на <b>${newEmail}</b>. Если это не ты — смени пароль, адрес не изменится без подтверждения по ссылке из другого письма.` : `An email change to <b>${newEmail}</b> was requested for ${u.handle}. If this wasn’t you, change your password — the address won’t change without confirming the link in the other email.`}</p>`,
  }).catch(() => {})
  await recordAudit('email.change-request', { actorId: session.userId, meta: { to: newEmail } })
  return { ok: true }
}

export type EmailChangeOutcome = 'ok' | 'invalid' | 'mismatch' | 'taken'

/** Обработка ссылки из письма (страница /change-email). */
export async function confirmEmailChange(token: string): Promise<EmailChangeOutcome> {
  const p = await readToken(token)
  if (!p || p.purpose !== 'change-email' || !p.uid || !p.newEmail || !p.cur) return 'invalid'
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, p.uid)).limit(1)
  if (!u) return 'invalid'
  if (u.email !== p.cur) return 'mismatch' // почта менялась после выпуска ссылки
  try {
    // Новый адрес считаем подтверждённым (ссылку открыли из него).
    await db.update(users).set({ email: p.newEmail, emailVerifiedAt: new Date() }).where(eq(users.id, p.uid))
  } catch {
    return 'taken' // unique-констрейнт: адрес заняли между запросом и подтверждением
  }
  await recordAudit('email.change', { actorId: p.uid, meta: { to: p.newEmail } })
  revalidatePath('/settings')
  return 'ok'
}

// ── Сброс пароля ─────────────────────────────────────────────────────
/** Хвост хеша пароля в клейме: смена пароля инвалидирует все старые ссылки. */
const pwTail = (hash: string | null) => (hash ?? 'nopw').slice(-16)

export async function requestPasswordReset(_prev: { done?: boolean } | null, formData: FormData): Promise<{ done: boolean }> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const ip = await clientIpFromHeaders()
  // Троттлинг по ip и по адресу (анти-бомбинг чужой почты); ответ всегда одинаковый.
  const okIp = rateLimit(`pwreset:ip:${ip}`, 5, 15 * 60_000).ok
  const okEmail = rateLimit(`pwreset:email:${email}`, 3, 60 * 60_000).ok
  const [u] = await db.select({ id: users.id, handle: users.handle, hash: users.passwordHash }).from(users).where(eq(users.email, email)).limit(1)
  // Ответ всегда одинаковый — не раскрываем существование почты.
  if (u && okIp && okEmail) {
    const lang = await getLang()
    const ru = lang === 'ru'
    const token = await signToken({ uid: u.id, purpose: 'reset-password', pw: pwTail(u.hash) }, '1h')
    const link = `${appOrigin()}/reset-password?token=${encodeURIComponent(token)}`
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
