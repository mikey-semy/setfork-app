'use server'

import { getSession } from '@/shared/auth/session'
import { getListEvents, getTopicLists, getUserByHandle } from '../queries'
import { parseDayKey, type DetailsPage, type DetailsRequest, type ListEvent, type TopicList } from './types'

// Детали ленты подгружаются ТОЛЬКО по раскрытию: у активного профиля это тысячи
// строк, и тащить их в первый ответ страницы ради свёрнутой сводки незачем.

/** Окно ленты из ключа: `YYYY-MM-DD` — день, `YYYY-MM` — месяц. */
function windowOf(key: string): { from: Date; to: Date } | null {
  const day = parseDayKey(key)
  if (day) {
    const to = new Date(day)
    to.setDate(to.getDate() + 1)
    return { from: day, to }
  }
  const month = /^(\d{4})-(\d{2})$/.exec(key)
  if (!month) return null
  const from = new Date(Number(month[1]), Number(month[2]) - 1, 1)
  const to = new Date(from)
  to.setMonth(to.getMonth() + 1)
  return { from, to }
}

/**
 * Раскрытие темы: без `slug` — списки, в которых шла работа, со `slug` — сами
 * события внутри одного списка.
 *
 * Права проверяются заново (ник, окно и slug приходят от клиента): чужой
 * приватный профиль молчит, а видимость самих списков гейтит запрос.
 */
export async function loadActivityDetails(handle: string, req: DetailsRequest): Promise<DetailsPage<TopicList | ListEvent>> {
  const empty = { items: [], total: 0 }
  const window = windowOf(req.windowKey)
  if (!window) return empty

  const [viewer, user] = await Promise.all([getSession(), getUserByHandle(handle)])
  if (!user) return empty
  if (user.profilePrivate && viewer?.userId !== user.id) return empty

  const { from, to } = window
  return req.slug
    ? getListEvents(user.id, req.kind, req.slug, from, to, viewer?.userId)
    : getTopicLists(user.id, req.kind, from, to, viewer?.userId)
}
