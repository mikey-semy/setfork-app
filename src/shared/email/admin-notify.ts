import 'server-only'
import { inArray } from 'drizzle-orm'
import { db, users } from '@/shared/db'
import { getEmailSettings } from '@/shared/settings/email'
import { DEFAULT_LANG, type Lang } from '@/shared/i18n'
import { sendMail } from './mailer'

// Куда слать админ-уведомления (фидбек, жалобы): настройка email.notify_to из
// админки (через запятую) → фолбэк: email'ы админов из ADMIN_HANDLES.
export async function adminNotifyRecipients(): Promise<Array<{ email: string; lang: Lang }>> {
  const { notifyTo } = await getEmailSettings()
  const configured = notifyTo
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.includes('@'))
  // За адресом из настройки аккаунта может и не быть — языку взяться неоткуда.
  if (configured.length) return configured.map((email) => ({ email, lang: DEFAULT_LANG }))

  const handles = (process.env.ADMIN_HANDLES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (!handles.length) return []
  const rows = await db.select({ email: users.email, lang: users.lang }).from(users).where(inArray(users.handle, handles))
  return rows.filter((r): r is { email: string; lang: Lang } => !!r.email)
}

/** Письмо админам (best-effort: без SMTP/получателей тихо пропускается, ошибок не бросает). */
export async function notifyAdmins(subject: string, body: string): Promise<void> {
  try {
    const recipients = await adminNotifyRecipients()
    if (!recipients.length) return
    await Promise.all(recipients.map((r) => sendMail({ to: r.email, lang: r.lang, subject, body })))
  } catch {
    // уведомление — не критичный путь
  }
}
