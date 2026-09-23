'use client'

import { stripHandleInput } from '@/shared/auth/handle-input'

export type FoundUser = { handle: string; avatarUrl: string | null }

/** Пауза после нажатия, прежде чем спрашивать сервер. Поиск людей ограничен по частоте
 *  на человека (60 в минуту, общий на все поля), и запрос на КАЖДУЮ букву съедал его за
 *  пару ников. Одно число на все подсказки, которые печатают на ходу. */
export const TYPEAHEAD_DEBOUNCE_MS = 150

/** Ответ поиска людей. `limited` — сервер отказал по частоте (429): это НЕ «никого нет»,
 *  и полю есть что сказать человеку, а не молча убрать подсказку. */
export type PeopleSearch = { users: FoundUser[]; limited: boolean }

/**
 * Люди по префиксу ника — клиентский вход в `/api/users/search` для поля ника,
 * упоминаний, выбора исполнителя и подсказок строки поиска. «@» снимается здесь же,
 * тем же правилом, что на сервере. Отмена (`signal`) и сбой сети дают пустой ответ:
 * подсказка — помощь, а не условие, ник всё равно можно набрать целиком.
 */
export async function searchPeople(raw: string, signal?: AbortSignal): Promise<PeopleSearch> {
  const q = stripHandleInput(raw)
  if (!q) return { users: [], limited: false }
  try {
    const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, { cache: 'no-store', signal })
    if (res.status === 429) return { users: [], limited: true }
    if (!res.ok) return { users: [], limited: false }
    const data: unknown = await res.json()
    return { users: Array.isArray(data) ? (data as FoundUser[]) : [], limited: false }
  } catch {
    return { users: [], limited: false }
  }
}

/** То же без признака лимита — для мест, где подсказка лишь дополняет список. */
export async function searchUsers(raw: string, signal?: AbortSignal): Promise<FoundUser[]> {
  return (await searchPeople(raw, signal)).users
}
