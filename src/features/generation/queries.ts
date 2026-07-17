import 'server-only'
import { desc, eq } from 'drizzle-orm'
import { db, generationCandidates, generations, type GenerationCandidate } from '@/shared/db'

export interface GenerationView {
  id: string
  query: string
  lang: string
  chosenTemplateId: string | null
  status: GenerationStatus
  candidates: GenerationCandidate[]
}

/** Статус пишет воркер (колонка generations.status). Раньше ВЫВОДИЛСЯ из таблицы jobs запросом по
 *  payload->>'generationId' — без индекса, на каждый поллинг каждого смотрящего. */
export type GenerationStatus = 'pending' | 'done' | 'failed' | 'clarify'

/** Генерация с вариантами-кандидатами (для экрана-чата). Только владельцу. */
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
    status: gen.status,
    candidates,
  }
}

export interface GenerationBrief {
  id: string
  query: string
  status: GenerationStatus
  chosenTemplateId: string | null
  createdAt: Date
}

/** История генераций пользователя — и этой сессии, и прошлых. Идёт по индексу (user_id, created_at). */
export async function getRecentGenerations(userId: string, limit = 20): Promise<GenerationBrief[]> {
  return db
    .select({
      id: generations.id,
      query: generations.query,
      status: generations.status,
      chosenTemplateId: generations.chosenTemplateId,
      createdAt: generations.createdAt,
    })
    .from(generations)
    .where(eq(generations.userId, userId))
    .orderBy(desc(generations.createdAt))
    .limit(limit)
}
