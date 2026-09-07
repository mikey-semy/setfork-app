import type { NotificationItem } from './queries'

/**
 * КУДА ВЕДЁТ УВЕДОМЛЕНИЕ — ОДНО ПРАВИЛО НА ВСЕ СПИСКИ.
 *
 * Оно было переписано дважды: на странице уведомлений и в колокольчике. Копии
 * расходятся тихо и в ту сторону, которую человек замечает последней: я добавил
 * обсуждения, поправил страницу — и колокольчик продолжал бы вести «в список», то есть
 * уведомление о разговоре высаживало бы человека там, где разговора не видно.
 *
 * Порядок ветвей — от частного к общему: подписка на человека, потом конкретная
 * сущность, потом список. `null` значит «вести некуда» — вызывающий решает сам
 * (колокольчик уводит в ленту уведомлений, страница оставляет строку без ссылки).
 *
 * Родственник — `resolveNotificationDisplay` для письма и пуша: там на входе id, а не
 * номера, и адрес нужен АБСОЛЮТНЫЙ. Общего кода у них нет, но правило одно, и меняются
 * они парой.
 */
export function notificationHref(n: Pick<NotificationItem, 'type' | 'actorHandle' | 'ownerHandle' | 'slug' | 'issueNumber' | 'discussionNumber' | 'suggestionId'>): string | null {
  if (n.type === 'follow') return `/${n.actorHandle ?? ''}`
  const listHref = n.ownerHandle && n.slug ? `/${n.ownerHandle}/${n.slug}` : null
  if (!listHref) return null
  if (n.issueNumber != null) return `${listHref}/issues/${n.issueNumber}`
  if (n.discussionNumber != null) return `${listHref}/discussions/${n.discussionNumber}`
  if (n.suggestionId) return `${listHref}/suggestions/${n.suggestionId}`
  return listHref
}
