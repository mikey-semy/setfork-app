import 'server-only'
import { eq, inArray } from 'drizzle-orm'
import { db, notifications, users } from '@/shared/db'
import type { NotifyPrefs } from '@/shared/db/schema'
import { extractHandles } from './mentions'

type NotifType =
  | 'suggestion_new'
  | 'suggestion_accepted'
  | 'suggestion_rejected'
  | 'suggestion_comment'
  | 'issue_new'
  | 'issue_comment'
  | 'new_version'
  | 'star'
  | 'fork'
  | 'follow'
  | 'mention'
  | 'assigned'

// Тип события → ключ предпочтения получателя (follow не отключается — ключа нет).
const TYPE_PREF: Partial<Record<NotifType, keyof NotifyPrefs>> = {
  suggestion_new: 'newSuggestions',
  suggestion_accepted: 'suggestionResolved',
  suggestion_rejected: 'suggestionResolved',
  suggestion_comment: 'comments',
  issue_new: 'issues',
  issue_comment: 'comments',
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
}): Promise<void> {
  if (params.actorId && params.actorId === params.recipientId) return
  try {
    const [u] = await db.select({ prefs: users.notifyPrefs }).from(users).where(eq(users.id, params.recipientId)).limit(1)
    const prefs = (u?.prefs ?? {}) as NotifyPrefs
    const prefKey = TYPE_PREF[params.type]
    if (prefKey && prefs[prefKey] === false) return // отключено получателем
    await db.insert(notifications).values({
      recipientId: params.recipientId,
      actorId: params.actorId ?? null,
      type: params.type,
      templateId: params.templateId ?? null,
      issueId: params.issueId ?? null,
    })
  } catch {
    /* уведомление — не критичный путь */
  }
}

/** Рассылка нескольким получателям (дедуп, себя пропустит notify). */
export async function notifyMany(
  recipientIds: string[],
  params: { actorId?: string | null; type: NotifType; templateId?: string | null; issueId?: string | null },
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
  } catch {
    /* уведомление — не критичный путь */
  }
}
