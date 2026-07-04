import 'server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db, generationCandidates, generations, jobs, type GenerationCandidate } from '@/shared/db'

export interface GenerationView {
  id: string
  query: string
  lang: string
  chosenTemplateId: string | null
  candidates: GenerationCandidate[]
}

export type GenerationStatus = 'pending' | 'failed' | 'idle'

/** Статус фоновой генерации: есть ли задача в работе / упала последняя попытка. */
export async function getGenerationStatus(generationId: string): Promise<GenerationStatus> {
  const rows = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(and(eq(jobs.type, 'generate'), sql`${jobs.payload} ->> 'generationId' = ${generationId}`))
    .orderBy(desc(jobs.createdAt))
  if (rows.some((r) => r.status === 'pending' || r.status === 'processing')) return 'pending'
  if (rows[0]?.status === 'failed') return 'failed' // последняя попытка исчерпала ретраи
  return 'idle'
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
