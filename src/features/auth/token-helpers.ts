import 'server-only'
import { eq } from 'drizzle-orm'
import { db, users } from '@/shared/db'
import { signToken } from '@/shared/auth/tokens'
import { appOrigin } from '@/shared/auth/app-origin'
import { sendMail } from '@/shared/email/mailer'
import { emailButton, emailHint } from '@/shared/email/layout'
import { getLang } from '@/shared/i18n/server'
import { fill, t } from '@/shared/i18n'
import { escapeHtml as esc } from '@/shared/lib/escape'

// JWT-хелперы почтовых потоков + отправка верификационного письма.
// НЕ 'use server'-модуль: экспорт отсюда — обычная функция, а не публичный
// endpoint. sendVerificationEmail жил в email-flows и был вызываем анонимом
// с произвольным userId (спам/enumeration в обход rate-limit) — теперь
// action-обёртки сами решают, кого и как часто (react-doctor, PR #213/#215).

/** Письмо «подтверди почту». Вызывается из регистрации и resendVerification —
 *  обе обёртки сами гейтят (своя сессия / свой свежесозданный аккаунт). */
export async function sendVerificationEmail(userId: string): Promise<boolean> {
  const [u] = await db.select({ email: users.email, handle: users.handle, verified: users.emailVerifiedAt }).from(users).where(eq(users.id, userId)).limit(1)
  if (!u?.email || u.verified) return false
  // Язык и подпись токена друг от друга не зависят — ждём их разом.
  const [lang, token] = await Promise.all([getLang(), signToken({ uid: userId, email: u.email, purpose: 'verify-email' }, '24h')])
  const link = `${appOrigin()}/verify-email?token=${encodeURIComponent(token)}`
  return sendMail({
    to: u.email,
    lang,
    subject: t('email.verifySubject', lang),
    body:
      `<p style="margin:0">${esc(fill('email.verifyBody', lang, { handle: u.handle }))}</p>` +
      emailButton(link, t('email.verifyAction', lang)) +
      emailHint(t('email.verifyHint', lang)),
  })
}
