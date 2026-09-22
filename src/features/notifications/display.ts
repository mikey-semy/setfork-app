import 'server-only'
import { and, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db, discussions, issues, templates, users } from '@/shared/db'
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
  discussionId?: string | null
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

  // Номер треда — то, чем обсуждение зовут в адресе. Без него письмо про ответ вело бы
  // на список, и человек искал бы разговор глазами.
  const [disc] = p.discussionId && p.templateId
    ? await db
        .select({ number: discussions.number })
        .from(discussions)
        .where(and(eq(discussions.id, p.discussionId), eq(discussions.templateId, p.templateId)))
        .limit(1)
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
          : disc
            ? `${base}/discussions/${disc.number}`
            : p.suggestionId && tpl
              ? `${base}/suggestions/${p.suggestionId}`
              : base
  // ⚠️ У ПЕРЕДАЧИ ВЛАДЕНИЯ НАЗВАНИЕ СПИСКА В ПИСЬМО НЕ ПОПАДАЕТ. Само письмо уходит
  // мимо гейта видимости (получатель списка ещё/уже не видит — см. TRANSFER_TYPES), и
  // без этой оговорки предложение стало бы способом сообщить заголовок приватного
  // списка кому угодно: предложил — название уехало в тему письма — получатель
  // отказался. Какой именно список, человек увидит в настройках, приняв решение;
  // адрес письма туда и ведёт.
  const hidesTitle = p.type.startsWith('transfer_')
  const shown = hidesTitle ? '' : listTitle
  const text = shown ? `${actorHandle} ${verb} ${shown}` : `${actorHandle} ${verb}`

  return { actorHandle, verb, listTitle: shown, url, text }
}
