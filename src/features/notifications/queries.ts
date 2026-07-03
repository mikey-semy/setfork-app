import 'server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db, issues, notifications, templates, users } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
import { avatarSrc } from '@/shared/media'

export type NotificationType =
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
}

export async function getUnreadCount(userId: string): Promise<number> {
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.recipientId, userId), eq(notifications.read, false)))
  return r?.c ?? 0
}

export async function getNotifications(userId: string, limit = 50): Promise<NotificationItem[]> {
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
    })
    .from(notifications)
    .leftJoin(actor, eq(notifications.actorId, actor.id))
    .leftJoin(templates, eq(notifications.templateId, templates.id))
    .leftJoin(owner, eq(owner.id, templates.ownerId))
    .leftJoin(issues, eq(notifications.issueId, issues.id))
    .where(eq(notifications.recipientId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)

  return Promise.all(
    rows.map(async (r) => ({ ...r, actorAvatarUrl: await avatarSrc(r.actorAvatarUrl, 64) })),
  ) as Promise<NotificationItem[]>
}
