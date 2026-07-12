import 'server-only'
import { inArray } from 'drizzle-orm'
import { db, users } from '@/shared/db'
import { getEmailSettings } from '@/shared/settings/email'
import { sendMail } from './mailer'

// Куда слать админ-уведомления (фидбек, жалобы): настройка email.notify_to из
// админки (через запятую) → фолбэк: email'ы админов из ADMIN_HANDLES.
export async function adminNotifyRecipients(): Promise<string[]> {
  const { notifyTo } = await getEmailSettings()
  const configured = notifyTo
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.includes('@'))
  if (configured.length) return configured

  const handles = (process.env.ADMIN_HANDLES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (!handles.length) return []
  const rows = await db.select({ email: users.email }).from(users).where(inArray(users.handle, handles))
  return rows.map((r) => r.email).filter((e): e is string => !!e)
}

/** Письмо админам (best-effort: без SMTP/получателей тихо пропускается, ошибок не бросает). */
export async function notifyAdmins(subject: string, html: string): Promise<void> {
  try {
    const emails = await adminNotifyRecipients()
    if (!emails.length) return
    await Promise.all(emails.map((to) => sendMail({ to, subject, html })))
  } catch {
    // уведомление — не критичный путь
  }
}
