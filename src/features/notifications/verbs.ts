import type { TKey } from '@/shared/i18n'
import type { NotificationType } from './queries'

/**
 * Тип события → ключ глагола. ОДНА таблица на приложение.
 *
 * До этого она была скопирована четыре раза: колокольчик, страница уведомлений,
 * роут браузерных уведомлений и сборка текста для письма/пуша. Добавление нового
 * типа требовало вспомнить про все четыре — и `Record<NotificationType, …>`
 * ловил это только компиляцией, по одному месту за прогон.
 *
 * Файл без 'server-only': им пользуется и клиентский колокольчик.
 */
export const NOTIF_VERB: Record<NotificationType, TKey> = {
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
  review_requested: 'notifReviewRequested',
  transfer_incoming: 'notifTransferIncoming',
  transfer_accepted: 'notifTransferAccepted',
  transfer_declined: 'notifTransferDeclined',
}
