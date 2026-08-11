import 'server-only'
import nodemailer from 'nodemailer'
import { getEmailSettings } from '@/shared/settings/email'
import { renderEmail } from './layout'
import type { Lang } from '@/shared/i18n'

// Отправка почты через СВОЙ SMTP (настройки в админке / env), без сторонних сервисов.
// Если host не задан — тихо no-op (dev без почты просто пропускает отправку).
// Dev: docker-compose поднимает MailHog (SMTP :1025, UI :8025).

/** Грубое html→text для текстовой части письма. */
function toText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Best-effort отправка. Возвращает false, если SMTP не настроен или отправка не удалась.
 *
 * `body` — ТОЛЬКО содержимое письма: шапку и подвал сайта добавляет renderEmail,
 * поэтому отправить письмо без подвала нельзя. `note` — строка «почему это письмо
 * пришло» для уведомлений и рассылок; служебным письмам она не нужна.
 */
export async function sendMail(msg: {
  to: string
  subject: string
  body: string
  lang: Lang
  note?: string
  text?: string
  /** Адрес отписки (unsubscribeUrl) — ТОЛЬКО для массовых писем: дайджеста и
   *  уведомлений. Служебным (подтверждение адреса, сброс пароля) отписка не
   *  положена: их отправку пользователь инициирует сам. */
  unsubscribeUrl?: string
}): Promise<boolean> {
  const s = await getEmailSettings()
  if (!s.host) return false
  const html = renderEmail({ lang: msg.lang, body: msg.body, note: msg.note, unsubscribeUrl: msg.unsubscribeUrl })
  // RFC 8058: пара заголовков превращает кнопку «Отписаться» в почтовом клиенте
  // в один POST, без захода на сайт. Gmail и Yahoo требуют этого от массовых
  // отправителей, а mail-tester снимает за отсутствие балл.
  const headers = msg.unsubscribeUrl
    ? { 'List-Unsubscribe': `<${msg.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    : undefined
  const transport = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure, // true для 465 (implicit TLS)
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
  })
  try {
    await transport.sendMail({ from: s.from, to: msg.to, subject: msg.subject, html, text: msg.text ?? toText(html), headers })
    return true
  } catch (e) {
    console.warn('[email] send failed:', e instanceof Error ? e.message : e)
    return false
  }
}
