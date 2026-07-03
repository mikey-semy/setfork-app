import 'server-only'
import type { Notifier } from '@/core'
import { notify, notifyMany } from './notify'

// Адаптер порта Notifier поверх notify.ts (домен: listId → БД: templateId).
export const notifier: Notifier = {
  notify: (i) => notify({ recipientId: i.recipientId, actorId: i.actorId, type: i.type, templateId: i.listId, issueId: i.issueId }),
  notifyMany: (ids, i) => notifyMany(ids, { actorId: i.actorId, type: i.type, templateId: i.listId, issueId: i.issueId }),
}
