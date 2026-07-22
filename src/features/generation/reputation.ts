import 'server-only'
import { isNotNull, eq, and, sql } from 'drizzle-orm'
import { db, generationMessages, generations } from '@/shared/db'

/**
 * Репутация гномов НАРУЖУ (HQ §6, слой «репутация»): доля генераций с участием
 * гнома, где пользователь принял список. Пользователь видит в чате, почему
 * советам можно доверять — «предложения подтверждаются практикой».
 *
 * Кеш 5 минут: чат перерисовывается поллингом каждые 2с, а репутация меняется
 * медленно; свежесть до минут — норм.
 */

export interface GnomeRep {
  gens: number
  accepted: number
}

/** Меньше — не показываем цифру: на 2 генерациях «50%» вводит в заблуждение. */
export const REP_MIN_GENS = 5

let cache: { at: number; data: Record<string, GnomeRep> } | null = null

export async function gnomeReputation(): Promise<Record<string, GnomeRep>> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.data
  try {
    const rows = await db
      .select({
        who: generationMessages.who,
        gens: sql<number>`count(distinct ${generations.id})::int`,
        accepted: sql<number>`count(distinct ${generations.id}) filter (where ${generations.chosenTemplateId} is not null)::int`,
      })
      .from(generationMessages)
      .innerJoin(generations, eq(generations.id, generationMessages.generationId))
      .where(and(eq(generationMessages.kind, 'draft'), isNotNull(generationMessages.who)))
      .groupBy(generationMessages.who)
    const data: Record<string, GnomeRep> = {}
    for (const r of rows) if (r.who) data[r.who] = { gens: r.gens, accepted: r.accepted }
    cache = { at: Date.now(), data }
    return data
  } catch {
    return cache?.data ?? {} // без репутации чат важнее бейджа
  }
}
