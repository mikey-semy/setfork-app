import 'server-only'
import { inArray } from 'drizzle-orm'
import { appSettings, db } from '@/shared/db'
import { SITE_HOST } from '@/shared/site'

// Настройки SMTP. Значения из БД (app_settings, редактируются в админке) перекрывают env;
// пустое поле в БД → берётся env. Пароль не отдаём на клиент (только маска).
export interface EmailSettings {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  from: string
  /** Адрес(а) для админ-уведомлений (фидбек, жалобы), через запятую. Пусто — email админов из ADMIN_HANDLES. */
  notifyTo: string
}

export const EMAIL_KEYS = {
  host: 'smtp.host',
  port: 'smtp.port',
  secure: 'smtp.secure',
  user: 'smtp.user',
  pass: 'smtp.pass',
  from: 'smtp.from',
  notifyTo: 'email.notify_to',
} as const

let cache: EmailSettings | null = null
export function clearEmailCache(): void {
  cache = null
}

export async function getEmailSettings(): Promise<EmailSettings> {
  if (cache) return cache
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, Object.values(EMAIL_KEYS)))
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const val = (key: string, env: string) => (m[key]?.trim() || process.env[env] || '').trim()

  cache = {
    host: val(EMAIL_KEYS.host, 'SMTP_HOST'),
    port: Number(val(EMAIL_KEYS.port, 'SMTP_PORT')) || 587,
    secure: (m[EMAIL_KEYS.secure] ?? (process.env.SMTP_SECURE === 'true' ? 'true' : 'false')) === 'true',
    user: val(EMAIL_KEYS.user, 'SMTP_USER'),
    pass: val(EMAIL_KEYS.pass, 'SMTP_PASS'),
    from: val(EMAIL_KEYS.from, 'SMTP_FROM') || `SetFork <no-reply@${SITE_HOST}>`,
    notifyTo: val(EMAIL_KEYS.notifyTo, 'NOTIFY_EMAIL'),
  }
  return cache
}

/** Настроена ли отправка почты (есть host). */
export async function emailEnabled(): Promise<boolean> {
  return Boolean((await getEmailSettings()).host)
}

/** «ab••••••••yz» — для показа секрета в UI без раскрытия. */
export function maskSecret(v: string): string {
  if (!v) return ''
  if (v.length <= 8) return '•'.repeat(6)
  return `${v.slice(0, 2)}${'•'.repeat(8)}${v.slice(-2)}`
}
