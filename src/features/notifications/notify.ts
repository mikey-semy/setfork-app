import 'server-only'
import { db, notifications } from '@/shared/db'

type NotifType = 'suggestion_new' | 'suggestion_accepted' | 'suggestion_rejected' | 'star' | 'fork'

/** Создаёт уведомление. Себе не шлём (actor === recipient). Ошибки глотаем — некритично. */
export async function notify(params: {
  recipientId: string
  actorId?: string | null
  type: NotifType
  templateId?: string | null
}): Promise<void> {
  if (params.actorId && params.actorId === params.recipientId) return
  try {
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
