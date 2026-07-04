import 'server-only'
import { and, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db, issues, templates, users } from '@/shared/db'
import { t, tr, type Lang, type TKey } from '@/shared/i18n'
import type { NotificationType } from './queries'

// Тип события → ключ глагола (тот же набор, что в колокольчике).
const VERB: Record<NotificationType, TKey> = {
  suggestion_new: 'notifSuggestionNew',
  suggestion_accepted: 'notifAccepted',
  suggestion_rejected: 'notifRejected',
  suggestion_comment: 'notifSuggestionComment',
  issue_new: 'notifIssueNew',
  issue_comment: 'notifIssueComment',
  new_version: 'notifNewVersion',
  star: 'notifStar',
  fork: 'notifFork',
  follow: 'notifFollow',
  mention: 'notifMention',
  assigned: 'notifAssigned',
}

const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')

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
  const verb = t(VERB[p.type], p.lang)

  const base = tpl ? `${appUrl()}/${tpl.owner}/${tpl.slug}` : appUrl()
  const url =
    p.type === 'follow'
      ? `${appUrl()}/${actorHandle}`
      : iss
        ? `${base}/issues/${iss.number}`
        : p.suggestionId && tpl
          ? `${base}/suggestions/${p.suggestionId}`
          : base
  const text = listTitle ? `${actorHandle} ${verb} ${listTitle}` : `${actorHandle} ${verb}`

  return { actorHandle, verb, listTitle, url, text }
}
