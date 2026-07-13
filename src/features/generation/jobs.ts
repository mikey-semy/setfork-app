import 'server-only'
import type { Lang } from '@/shared/i18n'
import { addCandidate } from './service'

export interface GenerateJobPayload {
  generationId: string
  userId: string
  query: string
  lang: Lang
  idx: number
}

/** Обработчик задачи AI-генерации варианта. Бросает при ошибке ИИ → ретрай. */
export async function runGenerateJob(payload: unknown): Promise<void> {
  const p = payload as GenerateJobPayload
  const ok = await addCandidate(p.generationId, p.userId, p.query, p.lang, p.idx)
  if (!ok) throw new Error('generation failed (AI error)')
}
