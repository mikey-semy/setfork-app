'use server'

import { requireSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { pinnableFor } from './queries'

/**
 * Поиск в окне «Настроить закреплённые» — по ВСЕМ публичным спискам владельца, а не по
 * загруженному окну: у владельца бывают сотни списков, и искать среди первой страницы
 * значило бы не найти тот, ради которого окно открыли.
 */
export async function findPinnableLists(q: string) {
  const session = await requireSession()
  return pinnableFor(session.userId, await getLang(), q)
}
