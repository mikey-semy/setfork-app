import 'server-only'
import nodemailer from 'nodemailer'
import { getEmailSettings } from '@/shared/settings/email'

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

/** Best-effort отправка. Возвращает false, если SMTP не настроен или отправка не удалась. */
export async function sendMail(msg: { to: string; subject: string; html: string; text?: string }): Promise<boolean> {
  const s = await getEmailSettings()
  if (!s.host) return false
  const transport = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure, // true для 465 (implicit TLS)
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
  })
  try {
    await transport.sendMail({ from: s.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text ?? toText(msg.html) })
    return true
  } catch (e) {
    console.warn('[email] send failed:', e instanceof Error ? e.message : e)
    return false
  }
}
