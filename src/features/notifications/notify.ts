import 'server-only'
import { eq } from 'drizzle-orm'
import { db, notifications, users } from '@/shared/db'
import type { NotifyPrefs } from '@/shared/db/schema'

type NotifType = 'suggestion_new' | 'suggestion_accepted' | 'suggestion_rejected' | 'star' | 'fork'

// Тип события → ключ предпочтения получателя.
const TYPE_PREF: Record<NotifType, keyof NotifyPrefs> = {
  suggestion_new: 'newSuggestions',
  suggestion_accepted: 'suggestionResolved',
  suggestion_rejected: 'suggestionResolved',
  star: 'stars',
  fork: 'forks',
}

/** Создаёт уведомление. Себе не шлём; уважаем предпочтения получателя. Ошибки глотаем. */
export async function notify(params: {
  recipientId: string
  actorId?: string | null
  type: NotifType
  templateId?: string | null
}): Promise<void> {
  if (params.actorId && params.actorId === params.recipientId) return
  try {
    const [u] = await db.select({ prefs: users.notifyPrefs }).from(users).where(eq(users.id, params.recipientId)).limit(1)
    const prefs = (u?.prefs ?? {}) as NotifyPrefs
    if (prefs[TYPE_PREF[params.type]] === false) return // отключено получателем
    await db.insert(notifications).values({
      recipientId: params.recipientId,
      actorId: params.actorId ?? null,
      type: params.type,
      templateId: params.templateId ?? null,
    })
  } catch {
    /* уведомление — не критичный путь */
  }
}
