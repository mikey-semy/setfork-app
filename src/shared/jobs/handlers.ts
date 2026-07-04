import 'server-only'
import type { Lang } from '@/shared/i18n'
import type { NotificationType } from '@/features/notifications/queries'
import { sendNotificationEmail } from '@/features/notifications/email'

export interface EmailJobPayload {
  to: string
  lang: Lang
  actorId?: string | null
  type: NotificationType
  templateId?: string | null
  issueId?: string | null
}

/** Обработчик email-задачи. Бросает исключение при неудаче → воркер сделает ретрай. */
export async function runEmailJob(payload: unknown): Promise<void> {
  const p = payload as EmailJobPayload
  const ok = await sendNotificationEmail(p)
  if (!ok) throw new Error('email not sent (SMTP error)')
}
