'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/shared/auth/admin'
import { saveSettings } from '@/shared/settings/kv'
import { clearMcpCache, MCP_KEYS } from '@/shared/settings/mcp'
import { resolveMethodList } from './tools/commitics'

export type CommiticsMethodResult = { ok: true; address: string | null } | { error: 'notFound' | 'notPublic' }

/**
 * Метод Commitics для сценария MCP. Админ вводит АДРЕС (так его видно на сайте), а
 * хранится id найденного списка: адрес меняется, id — нет (см. `shared/settings/mcp`).
 * Пустое поле — снять метод. Список не найден или закрыт — отказ с причиной, а не тихое
 * сохранение: закрытый метод чужие агенты не прочтут.
 */
export async function setCommiticsMethod(raw: string): Promise<CommiticsMethodResult> {
  await requireAdmin()
  const input = raw.trim()
  if (!input) {
    await saveSettings({ [MCP_KEYS.commiticsListId]: '' })
    clearMcpCache()
    revalidatePath('/admin')
    return { ok: true, address: null }
  }
  const found = await resolveMethodList(input)
  if ('error' in found) return found
  await saveSettings({ [MCP_KEYS.commiticsListId]: found.id })
  clearMcpCache()
  revalidatePath('/admin')
  return { ok: true, address: `${found.handle}/${found.slug}` }
}
