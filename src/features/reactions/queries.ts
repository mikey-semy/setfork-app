import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, reactions } from '@/shared/db'
import type { ReactionAgg, ReactionTarget } from './constants'

/** Агрегаты реакций для набора целей одного типа: { targetId → [{emoji,count,mine}] }. */
export async function getReactionsFor(
  targetType: ReactionTarget,
  ids: string[],
  userId?: string | null,
): Promise<Record<string, ReactionAgg[]>> {
  const out: Record<string, ReactionAgg[]> = {}
  if (ids.length === 0) return out
  const rows = await db
    .select({
      targetId: reactions.targetId,
      emoji: reactions.emoji,
      count: sql<number>`count(*)::int`,
      // сравнение по тексту — без каста uuid; пустая строка не матчит никого.
      mine: sql<boolean>`bool_or(${reactions.userId}::text = ${userId ?? ''})`,
    })
    .from(reactions)
    .where(and(eq(reactions.targetType, targetType), inArray(reactions.targetId, ids)))
    .groupBy(reactions.targetId, reactions.emoji)

  for (const r of rows) {
    ;(out[r.targetId] ??= []).push({ emoji: r.emoji, count: Number(r.count), mine: !!r.mine })
  }
  // популярные слева; при равенстве — стабильно по эмодзи.
  for (const id of Object.keys(out)) out[id].sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji))
  return out
}
