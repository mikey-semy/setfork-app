import 'server-only'
import type { Lang } from '@/shared/i18n'
import { sendPushToUser } from '@/shared/push/send'
import { resolveNotificationDisplay } from './display'
import { sendNotificationEmail } from './email'
import type { NotificationType } from './queries'
import { recipientSeesList } from './list-access'
import { TRANSFER_TYPES } from './notify'

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

/**
 * Обработчик email-задачи. Бросает исключение при неудаче → воркер сделает ретрай.
 *
 * ⚠️ ДОСТУП ПЕРЕСПРАШИВАЕТСЯ ПЕРЕД ОТПРАВКОЙ, хотя он уже проверен при постановке.
 * Между ними лежит очередь: список успевают закрыть, снять модерацией или отобрать
 * соредакторство — и письмо с приватным названием уходит уже после того, как право
 * кончилось. Задача без `userId` — из очереди, набранной до появления ссылки отписки;
 * её проверить нечем, и она уходит как прежде.
 */
export async function runEmailJob(payload: unknown): Promise<void> {
  const p = payload as EmailJobPayload
  if (!TRANSFER_TYPES.has(p.type) && p.templateId && p.userId && !(await recipientSeesList(p.templateId, p.userId))) return
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

/** Web-push уведомления на подписки пользователя (фоновый браузерный поп-ап).
 *  Доступ переспрашивается перед показом — по той же причине, что у письма выше. */
export async function runPushJob(payload: unknown): Promise<void> {
  const p = payload as PushJobPayload
  if (!TRANSFER_TYPES.has(p.type) && p.templateId && !(await recipientSeesList(p.templateId, p.userId))) return
  const d = await resolveNotificationDisplay(p)
  await sendPushToUser(p.userId, { title: 'SetFork', body: d.text, url: d.url })
}
