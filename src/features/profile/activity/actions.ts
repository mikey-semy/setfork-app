'use server'

import { getSession } from '@/shared/auth/session'
import { getActivityTopics, getUserByHandle } from '../queries'
import { parseDayKey, type ActivityTopic, type DayKey } from './types'

/**
 * Активность профиля за один день — подгружается кликом по клетке календаря.
 *
 * Отдельным вызовом, а не переходом по адресу: у GitHub фильтр по дню тоже живёт
 * в состоянии страницы, адрес профиля от него не меняется.
 *
 * Права проверяются здесь заново (день и ник приходят от клиента): чужой приватный
 * профиль не отвечает ничем, а видимость списков внутри тем гейтит сам запрос.
 */
export async function loadDayActivity(handle: string, day: DayKey): Promise<ActivityTopic[]> {
  const from = parseDayKey(day)
  if (!from) return []

  const [viewer, user] = await Promise.all([getSession(), getUserByHandle(handle)])
  if (!user) return []
  if (user.profilePrivate && viewer?.userId !== user.id) return []

  const to = new Date(from)
  to.setDate(to.getDate() + 1)
  return getActivityTopics(user.id, from, to, viewer?.userId)
}
