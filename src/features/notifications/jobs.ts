import 'server-only'
import type { Lang } from '@/shared/i18n'
import { sendPushToUser } from '@/shared/push/send'
import { resolveNotificationDisplay } from './display'
import { sendNotificationEmail } from './email'
import type { NotificationType } from './queries'

export interface EmailJobPayload {
  to: string
  /** Получатель — для ссылки отписки. Необязателен: задачи, поставленные до
   *  появления List-Unsubscribe, лежат в очереди без него и должны дойти. */
  userId?: string
  lang: Lang
  actorId?: string | null
  type: NotificationType
  templateId?: string | null
  issueId?: string | null
  discussionId?: string | null
}

/** Обработчик email-задачи. Бросает исключение при неудаче → воркер сделает ретрай. */
export async function runEmailJob(payload: unknown): Promise<void> {
  const p = payload as EmailJobPayload
  const ok = await sendNotificationEmail(p)
  if (!ok) throw new Error('email not sent (SMTP error)')
}

export interface PushJobPayload {
  userId: string
  lang: Lang
  actorId?: string | null
  type: NotificationType
  templateId?: string | null
  issueId?: string | null
  discussionId?: string | null
}

/** Web-push уведомления на подписки пользователя (фоновый браузерный поп-ап). */
export async function runPushJob(payload: unknown): Promise<void> {
  const p = payload as PushJobPayload
  const d = await resolveNotificationDisplay(p)
  await sendPushToUser(p.userId, { title: 'SetFork', body: d.text, url: d.url })
}
