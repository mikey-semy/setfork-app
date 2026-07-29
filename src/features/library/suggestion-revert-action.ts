'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/shared/auth/session'
import { revertSuggestion } from './suggestion-core'

/**
 * Откатить принятое предложение — экшен страницы.
 *
 * Тонкий по той же причине, что и слияние: решение принимает ядро (оно же под MCP),
 * а здесь только сессия и обновление страницы. Личность НЕ приходит аргументом —
 * иначе это была бы точка входа «откати от имени владельца» (см. караул в
 * tests/security/server-action-actor-identity.test.ts).
 *
 * Спорные пункты возвращаем вызывающему списком: человек должен увидеть, ЧТО
 * именно нельзя отменить автоматически, а не упереться в «не получилось».
 */
export async function revertSuggestionAction(
  suggestionId: string,
): Promise<{ ok: true; number: number | null } | { ok: false; reason: string; conflicts?: string[] }> {
  const session = await requireSession()
  const res = await revertSuggestion(session.userId, suggestionId)
  if (!res.ok) return { ok: false, reason: res.reason, conflicts: res.conflicts?.map((c) => c.title) }
  revalidatePath('/', 'layout')
  return { ok: true, number: res.number }
}
