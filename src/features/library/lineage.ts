import 'server-only'
import { and, eq, ne } from 'drizzle-orm'
import { db, generationCandidates, generations } from '@/shared/db'

/**
 * РОДОСЛОВНАЯ ПРИНЯТОГО СПИСКА — «почему он такой».
 *
 * Раньше провенанс жил только под кандидатом в чате генерации: человек уходил со страницы, и
 * объяснение исчезало вместе с ней. Между тем главный вопрос про список задают ПОЗЖЕ («откуда
 * это взялось?»), и отвечать на него надо там, где список читают.
 *
 * Заодно показываем ОТВЕРГНУТОЕ: какие ещё варианты предлагал совет и что не выбрали. Это не
 * украшение — это единственное место, где видно цену витка: за него заплачено, а осталось от
 * него внешне только одно.
 */
export interface ListLineage {
  generationId: string
  query: string
  createdAt: Date
  /** Провенанс ИМЕННО принятого кандидата (движок, эксперты, прецеденты, критик, пробелы опоры). */
  provenance: Record<string, unknown>
  /** Остальные кандидаты витка — что предлагали и не выбрали. */
  rejected: { idx: number; title: string; summary: string }[]
}

/** null — список сделан руками (или родословную не сохранили): панель просто не рисуется. */
export async function getListLineage(templateId: string): Promise<ListLineage | null> {
  const [gen] = await db
    .select({ id: generations.id, query: generations.query, createdAt: generations.createdAt, chosenIdx: generations.chosenIdx })
    .from(generations)
    .where(eq(generations.chosenTemplateId, templateId))
    .limit(1)
  if (!gen) return null

  // Индекс принятого кандидата известен только для витков после его введения. Для старых
  // берём первого кандидата: это честнее, чем не показать ничего, но провенанс тогда может
  // относиться к другому варианту — поэтому в UI такой случай подписан как приблизительный.
  const idx = gen.chosenIdx
  const [chosen] = await db
    .select({ idx: generationCandidates.idx, provenance: generationCandidates.provenance })
    .from(generationCandidates)
    .where(idx == null ? eq(generationCandidates.generationId, gen.id) : and(eq(generationCandidates.generationId, gen.id), eq(generationCandidates.idx, idx)))
    .orderBy(generationCandidates.idx)
    .limit(1)
  if (!chosen) return null

  const others = await db
    .select({ idx: generationCandidates.idx, title: generationCandidates.title, summary: generationCandidates.summary })
    .from(generationCandidates)
    .where(and(eq(generationCandidates.generationId, gen.id), ne(generationCandidates.idx, chosen.idx)))
    .orderBy(generationCandidates.idx)

  return {
    generationId: gen.id,
    query: gen.query,
    createdAt: gen.createdAt,
    provenance: (chosen.provenance ?? {}) as Record<string, unknown>,
    rejected: others.map((o) => ({ idx: o.idx, title: o.title, summary: o.summary ?? '' })),
    /** approximate помечаем отсутствием chosenIdx у витка — читается вызывающим. */
  }
}

/** Точна ли привязка провенанса к принятому варианту (у старых витков — нет). */
export async function isLineageExact(templateId: string): Promise<boolean> {
  const [gen] = await db.select({ chosenIdx: generations.chosenIdx }).from(generations).where(eq(generations.chosenTemplateId, templateId)).limit(1)
  return gen?.chosenIdx != null
}
