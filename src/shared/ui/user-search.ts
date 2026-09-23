'use client'

import { stripHandleInput } from '@/shared/auth/handle-input'

export type FoundUser = { handle: string; avatarUrl: string | null }

/**
 * Люди по префиксу ника — единственный клиентский вход в `/api/users/search`
 * для упоминаний, выбора исполнителя и поля ника. «@» снимается здесь же, тем же
 * правилом, что на сервере. Сбой сети или не-массив в ответе → пустой список:
 * подсказка — помощь, а не условие, ник всё равно можно набрать целиком.
 */
export async function searchUsers(raw: string, signal?: AbortSignal): Promise<FoundUser[]> {
  const q = stripHandleInput(raw)
  if (!q) return []
  try {
    const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, { signal })
    if (!res.ok) return []
    const data: unknown = await res.json()
    return Array.isArray(data) ? (data as FoundUser[]) : []
  } catch {
    return []
  }
}
