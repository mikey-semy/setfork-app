import 'server-only'
import { eq, inArray } from 'drizzle-orm'
import { db, notifications, users } from '@/shared/db'
import type { NotifyPrefs } from '@/shared/db/schema'
import { DEFAULT_LANG } from '@/shared/i18n'
import { emailEnabled } from '@/shared/settings/email'
import { enqueueJob } from '@/shared/jobs/queue'
import { pushEnabled } from '@/shared/push/vapid'
import { userHasPush } from '@/shared/push/send'
import { captureError } from '@/shared/observability'
import { extractHandles } from './mentions'

type NotifType =
  | 'suggestion_new'
  | 'suggestion_accepted'
  | 'suggestion_edited'
  | 'suggestion_rejected'
  | 'suggestion_comment'
  | 'issue_new'
  | 'issue_comment'
  | 'issue_closed_by_merge'
  | 'new_version'
  | 'star'
  | 'fork'
  | 'follow'
  | 'mention'
  | 'assigned'
  | 'review_requested'
  | 'review_dismissed'
  | 'transfer_incoming'
  | 'transfer_accepted'
  | 'transfer_declined'

// Тип события → ключ предпочтения получателя (follow не отключается — ключа нет).
const TYPE_PREF: Partial<Record<NotifType, keyof NotifyPrefs>> = {
  suggestion_new: 'newSuggestions',
  suggestion_accepted: 'suggestionResolved',
  suggestion_rejected: 'suggestionResolved',
  suggestion_comment: 'comments',
  // Правку СВОЕГО предложения чужими руками относим к тем же уведомлениям, что и
  // обсуждение: это разговор о правке, а не её судьба.
  suggestion_edited: 'comments',
  issue_new: 'issues',
  issue_comment: 'comments',
  issue_closed_by_merge: 'issues',
  new_version: 'watchedUpdates',
  star: 'stars',
  fork: 'forks',
}

/** Создаёт уведомление. Себе не шлём; уважаем предпочтения получателя. Ошибки глотаем. */
export async function notify(params: {
  recipientId: string
  actorId?: string | null
  type: NotifType
  templateId?: string | null
  issueId?: string | null
  suggestionId?: string | null
}): Promise<void> {
  if (params.actorId && params.actorId === params.recipientId) return
  try {
    const [u] = await db
      .select({ prefs: users.notifyPrefs, email: users.email, lang: users.lang })
      .from(users)
      .where(eq(users.id, params.recipientId))
      .limit(1)
    const prefs = (u?.prefs ?? {}) as NotifyPrefs
    const prefKey = TYPE_PREF[params.type]
    if (prefKey && prefs[prefKey] === false) return // отключено получателем
    await db.insert(notifications).values({
      recipientId: params.recipientId,
      actorId: params.actorId ?? null,
      type: params.type,
      templateId: params.templateId ?? null,
      issueId: params.issueId ?? null,
      suggestionId: params.suggestionId ?? null,
    })
    const refPayload = {
      lang: u?.lang ?? DEFAULT_LANG, // язык ДОСТАВКИ = язык получателя (users.lang, тип Lang)
      actorId: params.actorId ?? null,
      type: params.type,
      templateId: params.templateId ?? null,
      issueId: params.issueId ?? null,
      suggestionId: params.suggestionId ?? null,
    }

    // Дублируем на почту через очередь (durable + ретраи), если получатель включил
    // email-уведомления и SMTP настроен. Отправка уходит из request-пути к воркеру.
    if (prefs.email === true && u?.email && (await emailEnabled())) {
      // userId нужен письму для ссылки отписки (List-Unsubscribe).
      await enqueueJob('email', { to: u.email, userId: params.recipientId, ...refPayload })
    }

    // Фоновый web-push, если включён browser-pref, есть подписка и VAPID настроен.
    if (prefs.browser === true && (await pushEnabled()) && (await userHasPush(params.recipientId))) {
      await enqueueJob('push', { userId: params.recipientId, ...refPayload })
    }
  } catch (e) {
    // Уведомление — не критичный путь: не роняем вызывающего, но и не глотаем молча.
    captureError(e, { where: 'notify', type: params.type, recipientId: params.recipientId })
  }
}

/** Рассылка нескольким получателям (дедуп, себя пропустит notify). */
export async function notifyMany(
  recipientIds: string[],
  params: { actorId?: string | null; type: NotifType; templateId?: string | null; issueId?: string | null; suggestionId?: string | null },
): Promise<void> {
  const unique = [...new Set(recipientIds)].filter(Boolean)
  await Promise.all(unique.map((recipientId) => notify({ recipientId, ...params })))
}

/**
 * Разбирает @-упоминания в тексте и шлёт `mention`-уведомление каждому
 * существующему пользователю (кроме автора — это делает notify). Best-effort.
 */
export async function notifyMentions(params: {
  text: string
  actorId: string
  templateId?: string | null
  issueId?: string | null
}): Promise<void> {
  const handles = extractHandles(params.text)
  if (handles.length === 0) return
  try {
    const rows = await db.select({ id: users.id }).from(users).where(inArray(users.handle, handles))
    if (rows.length === 0) return
    await notifyMany(
      rows.map((r) => r.id),
      { actorId: params.actorId, type: 'mention', templateId: params.templateId ?? null, issueId: params.issueId ?? null },
    )
  } catch (e) {
    captureError(e, { where: 'notifyMentions', templateId: params.templateId })
  }
}
