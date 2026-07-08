import 'server-only'
import { eq } from 'drizzle-orm'
import { SignJWT, jwtVerify } from 'jose'
import { db, users } from '@/shared/db'
import { appOrigin } from '@/shared/auth/app-origin'
import { sendMail } from '@/shared/email/mailer'
import { getLang } from '@/shared/i18n/server'

// JWT-хелперы почтовых потоков + отправка верификационного письма.
// НЕ 'use server'-модуль: экспорт отсюда — обычная функция, а не публичный
// endpoint. sendVerificationEmail жил в email-flows и был вызываем анонимом
// с произвольным userId (спам/enumeration в обход rate-limit) — теперь
// action-обёртки сами решают, кого и как часто (react-doctor, PR #213/#215).

export function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET
  if (!s) throw new Error('AUTH_SECRET is not set')
  return new TextEncoder().encode(s)
}

export async function signToken(payload: Record<string, string>, ttl: string): Promise<string> {
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(ttl).sign(secretKey())
}

export async function readToken(token: string): Promise<Record<string, string> | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey())
    return payload as Record<string, string>
  } catch {
    return null
  }
}

export const button = (href: string, label: string) =>
  `<p style="margin:20px 0"><a href="${href}" style="background:#1c1c1a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${label}</a></p><p style="color:#6b6b66;font-size:13px">${href}</p>`

/** Письмо «подтверди почту». Вызывается из регистрации и resendVerification —
 *  обе обёртки сами гейтят (своя сессия / свой свежесозданный аккаунт). */
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
