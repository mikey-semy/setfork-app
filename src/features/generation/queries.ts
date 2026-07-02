import 'server-only'
import { eq } from 'drizzle-orm'
import { db, generationCandidates, generations, type GenerationCandidate } from '@/shared/db'

export interface GenerationView {
  id: string
  query: string
  lang: string
  chosenTemplateId: string | null
  candidates: GenerationCandidate[]
}

/** Генерация с вариантами-кандидатами (для экрана выбора). Только владельцу. */
export async function getGeneration(id: string, viewerId: string): Promise<GenerationView | null> {
  const gen = await db.query.generations.findFirst({ where: (g) => eq(g.id, id) })
  if (!gen || gen.userId !== viewerId) return null
  const candidates = await db
    .select()
    .from(generationCandidates)
    .where(eq(generationCandidates.generationId, id))
    .orderBy(generationCandidates.idx)
  return {
    id: gen.id,
    query: gen.query,
    lang: gen.lang,
    chosenTemplateId: gen.chosenTemplateId,
    candidates,
  }
}
