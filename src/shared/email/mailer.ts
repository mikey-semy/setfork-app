import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'

// Отправка почты через СВОЙ SMTP (env), без сторонних сервисов. Если SMTP не
// сконфигурирован — тихо no-op (dev без почты просто пропускает отправку).
// Dev: docker-compose поднимает MailHog (SMTP :1025, UI :8025).

let cached: Transporter | null | undefined // undefined = не инициализирован, null = не настроен

function transport(): Transporter | null {
  if (cached !== undefined) return cached
  const host = process.env.SMTP_HOST
  if (!host) {
    cached = null
    return null
  }
  cached = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true', // true для 465 (implicit TLS)
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
  })
  return cached
}

/** Настроена ли отправка почты (есть SMTP_HOST). */
export function emailEnabled(): boolean {
  return !!process.env.SMTP_HOST
}

const FROM = () => process.env.SMTP_FROM || 'SetFork <no-reply@setfork.com>'

/** Грубое html→text для текстовой части письма. */
function toText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Best-effort отправка. Ошибки глотаем (почта — не критичный путь). */
export async function sendMail(msg: { to: string; subject: string; html: string; text?: string }): Promise<boolean> {
  const t = transport()
  if (!t) return false
  try {
    await t.sendMail({ from: FROM(), to: msg.to, subject: msg.subject, html: msg.html, text: msg.text ?? toText(msg.html) })
    return true
  } catch (e) {
    console.warn('[email] send failed:', e instanceof Error ? e.message : e)
    return false
  }
}
