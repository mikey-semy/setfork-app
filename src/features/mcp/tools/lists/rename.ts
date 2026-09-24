// Смена адреса списка через MCP. Причина измениться у модуля одна — как агент меняет
// адрес: правил своих нет, они в `features/library/rename-core`, одни с формой настроек.

import 'server-only'
import { renameListCore, type RenameRefusal } from '@/features/library/rename-core'
import { SITE_URL, resolveListRefOrMoved } from '../shared'

const REFUSAL: Record<RenameRefusal, string> = {
  forbidden: 'only the list owner can change its address',
  empty: 'slug must not be empty',
  same: 'this is already the address of the list',
  invalid: 'use Latin letters, digits and hyphens for the address',
  taken: 'you already have a list at this address',
}

/** СМЕНИТЬ АДРЕС СПИСКА. Прежний адрес остаётся вести сюда же — и на сайте, и в git. */
export async function mcpRenameList(userId: string, input: { list: string; slug: string }) {
  const found = await resolveListRefOrMoved(input.list)
  if (!found) return { error: 'list not found' }
  const res = await renameListCore(userId, found.id, input.slug ?? '')
  if (!res.ok) {
    return { error: REFUSAL[res.reason] + (res.suggestion ? ` — "${res.suggestion}" is free` : ''), suggestion: res.suggestion }
  }
  const ref = `${res.owner}/${res.slug}`
  return {
    ref,
    previous: `${res.owner}/${res.previous}`,
    url: `${SITE_URL}/${ref}`,
    // Что сделать у себя: старый адрес ведёт сюда, но клоны лучше перенастроить.
    note: `The old address keeps redirecting here (site, git and skill downloads). Existing clones keep working; to update one: git remote set-url origin ${SITE_URL}/${ref}.git`,
  }
}
