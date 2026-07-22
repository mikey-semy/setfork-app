import 'server-only'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { db, generationMessages, generations } from '@/shared/db'

/**
 * Репутация гнома (слой «репутация», HQ §6): доля генераций с его черновиком,
 * где пользователь ПРИНЯЛ список. Ядро в shared/ai, а не в features — им
 * пользуется и совет (KPI-петля: репутация влияет на отбор экспертов), и чат
 * (бейдж). Кеш 5 минут: репутация меняется медленно, свежесть до минут — норм.
 */
export interface GnomeRep {
  gens: number
  accepted: number
}

/** Меньше — цифре нельзя верить: на 2 генерациях «50%» вводит в заблуждение. */
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
    return cache?.data ?? {}
  }
}

/**
 * Балл гнома для взвешивания отбора [0..1]: доля принятых при доверии, иначе
 * нейтральные 0.5 (мало данных — не наказываем и не превозносим).
 */
export function repScore(rep: Record<string, GnomeRep>, id: string): number {
  const r = rep[id]
  if (!r || r.gens < REP_MIN_GENS) return 0.5
  return r.accepted / r.gens
}
