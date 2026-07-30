import 'server-only'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { canViewList } from '@/core'
import { collaborators, db, issues, notifications, templates, users } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
import { avatarSrc } from '@/shared/media'

export type NotificationType =
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

export interface NotificationItem {
  id: string
  type: NotificationType
  read: boolean
  createdAt: Date
  actorHandle: string | null
  actorAvatarUrl: string | null
  ownerHandle: string | null
  slug: string | null
  title: LocaleText | null
  issueNumber: number | null
  suggestionId: string | null
}

/** Включены ли у пользователя браузерные уведомления (для монтирования нотификатора). */
export async function getBrowserNotifyEnabled(userId: string): Promise<boolean> {
  const [u] = await db.select({ prefs: users.notifyPrefs }).from(users).where(eq(users.id, userId)).limit(1)
  return (u?.prefs as { browser?: boolean } | undefined)?.browser === true
}

/**
 * Счётчик непрочитанного — по ТЕМ ЖЕ правилам видимости, что и сама лента. Иначе бейдж
 * показывал бы «3», а лента открывалась пустой: уведомления про списки, которые зритель
 * больше не видит, из неё выпадают. Заодно счётчик перестаёт быть сигналом «в том
 * приватном списке что-то произошло».
 *
 * Считаем по строкам, а не count(*): предикат доступа один на всё приложение
 * (canViewList), и дублировать его в SQL значит однажды с ним разойтись.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const rows = await visibleNotifications(userId, UNREAD_SCAN_LIMIT)
  return rows.filter((r) => !r.read).length
}

/** Сколько строк смотрим для счётчика: лента и так не бесконечная, а перебор нужен
 *  ради единого предиката доступа. */
const UNREAD_SCAN_LIMIT = 500

async function visibleNotifications(userId: string, limit: number) {
  const actor = alias(users, 'actor')
  const owner = alias(users, 'owner')
  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      read: notifications.read,
      createdAt: notifications.createdAt,
      actorHandle: actor.handle,
      actorAvatarUrl: actor.avatarUrl,
      ownerHandle: owner.handle,
      slug: templates.slug,
      title: templates.title,
      issueNumber: issues.number,
      suggestionId: notifications.suggestionId,
      templateId: notifications.templateId,
      listOwnerId: templates.ownerId,
      visibility: templates.visibility,
      status: templates.status,
      moderation: templates.moderation,
    })
    .from(notifications)
    .leftJoin(actor, eq(notifications.actorId, actor.id))
    .leftJoin(templates, eq(notifications.templateId, templates.id))
    .leftJoin(owner, eq(owner.id, templates.ownerId))
    .leftJoin(issues, eq(notifications.issueId, issues.id))
    .where(eq(notifications.recipientId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)

  // Соредакторство спрашиваем ОДНИМ запросом на всю ленту: приватный список виден и тем,
  // кто ведёт его вместе с владельцем.
  const listIds = [...new Set(rows.map((r) => r.templateId).filter((v): v is string => !!v))]
  const collab = new Set(
    listIds.length
      ? (
          await db
            .select({ templateId: collaborators.templateId })
            .from(collaborators)
            .where(and(eq(collaborators.userId, userId), inArray(collaborators.templateId, listIds)))
        ).map((r) => r.templateId)
      : [],
  )

  return rows.filter((r) => {
    // Уведомление без списка (подписка на человека, передача аккаунта) — не про доступ.
    if (!r.templateId || !r.visibility || !r.status || !r.moderation) return true
    return canViewList(
      { visibility: r.visibility, status: r.status, moderation: r.moderation },
      { isOwner: r.listOwnerId === userId, isCollaborator: collab.has(r.templateId) },
    )
  })
}

/**
 * Лента уведомлений ЗРИТЕЛЯ, отфильтрованная по видимости списка.
 *
 * Строка уведомления живёт вечно, а видимость списка меняется: уведомление пришло, пока
 * список был публичным, потом список закрыли (или сняли модерацией) — и лента продолжала
 * показывать ЕГО ТЕКУЩИЕ заголовок и слаг, потому что join брал актуальную строку
 * templates без проверки доступа. Приватные переименования читались бывшим наблюдателем
 * прямо из своей ленты (P1 из авто-ревью).
 *
 * Уведомление про невидимый сейчас список выпадает целиком — не «прячем заголовок»: сам
 * факт «в этом списке что-то произошло» тоже часть приватного.
 */
export async function getNotifications(userId: string, limit = 50): Promise<NotificationItem[]> {
  const rows = await visibleNotifications(userId, limit)
  return Promise.all(
    rows.map(async ({ templateId: _t, listOwnerId: _o, visibility: _v, status: _s, moderation: _m, ...r }) => ({
      ...r,
      actorAvatarUrl: await avatarSrc(r.actorAvatarUrl, 64),
    })),
  ) as Promise<NotificationItem[]>
}

