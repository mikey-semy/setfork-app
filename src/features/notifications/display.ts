import 'server-only'
import { and, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db, issues, templates, users } from '@/shared/db'
import { t, tr, type Lang, type TKey } from '@/shared/i18n'
import type { NotificationType } from './queries'
import { NOTIF_VERB } from './verbs'
import { appOrigin } from '@/shared/auth/app-origin'

// Тип события → ключ глагола (тот же набор, что в колокольчике).

export interface NotificationDisplay {
  actorHandle: string
  verb: string
  listTitle: string
  url: string
  /** Готовая строка: «actor verb listTitle» — для тела письма/пуша. */
  text: string
}

export interface NotificationRef {
  lang: Lang
  actorId?: string | null
  type: NotificationType
  templateId?: string | null
  issueId?: string | null
  suggestionId?: string | null
}

/**
 * Резолвит контекст уведомления (актор/список/issue) в готовые к показу поля.
 * Единый источник для email и web-push (и др. каналов) — без дублирования VERB и запросов.
 */
export async function resolveNotificationDisplay(p: NotificationRef): Promise<NotificationDisplay> {
  const actorAlias = alias(users, 'actor')
  const ownerAlias = alias(users, 'owner')

  const [actor] = p.actorId
    ? await db.select({ handle: actorAlias.handle }).from(actorAlias).where(eq(actorAlias.id, p.actorId)).limit(1)
    : [undefined]

  const [tpl] = p.templateId
    ? await db
        .select({ slug: templates.slug, title: templates.title, owner: ownerAlias.handle })
        .from(templates)
        .innerJoin(ownerAlias, eq(ownerAlias.id, templates.ownerId))
        .where(eq(templates.id, p.templateId))
        .limit(1)
    : [undefined]

  const [iss] = p.issueId && p.templateId
    ? await db.select({ number: issues.number }).from(issues).where(and(eq(issues.id, p.issueId), eq(issues.templateId, p.templateId))).limit(1)
    : [undefined]

  const actorHandle = actor?.handle ?? 'someone'
  const listTitle = tpl ? tr(tpl.title, p.lang) : ''
  const verb = t(NOTIF_VERB[p.type], p.lang)

  const base = tpl ? `${appOrigin()}/${tpl.owner}/${tpl.slug}` : appOrigin()
  const url =
    p.type === 'follow'
      ? `${appOrigin()}/${actorHandle}`
      : // Приглашение принять владение — на страницу настроек (список может быть
        // приватным, получатель его ещё не видит; принять/отклонить — там).
        p.type === 'transfer_incoming'
        ? `${appOrigin()}/settings`
        : iss
          ? `${base}/issues/${iss.number}`
          : p.suggestionId && tpl
            ? `${base}/suggestions/${p.suggestionId}`
            : base
  const text = listTitle ? `${actorHandle} ${verb} ${listTitle}` : `${actorHandle} ${verb}`

  return { actorHandle, verb, listTitle, url, text }
}
