import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { db, quizAttempts } from '@/shared/db'

export interface QuizState {
  selected: string[] // что зритель выбрал в последней попытке ([] — не проходил)
  correct: boolean // прошёл ли
  attempts: number // сколько раз пробовал
  submitted: boolean // была ли хоть одна попытка (иначе виджет в исходном виде)
}

const EMPTY: QuizState = { selected: [], correct: false, attempts: 0, submitted: false }

/** Состояние quiz-блоков списка для текущего зрителя (последняя попытка по bid). */
export async function getQuizState(templateId: string, bids: string[], userId?: string): Promise<Record<string, QuizState>> {
  const out: Record<string, QuizState> = {}
  const uniq = [...new Set(bids)].filter(Boolean)
  for (const b of uniq) out[b] = { ...EMPTY }
  if (!uniq.length || !userId) return out

  const rows = await db
    .select({ bid: quizAttempts.bid, selected: quizAttempts.selected, correct: quizAttempts.correct, attempts: quizAttempts.attempts })
    .from(quizAttempts)
    .where(and(eq(quizAttempts.templateId, templateId), inArray(quizAttempts.bid, uniq), eq(quizAttempts.userId, userId)))
  for (const r of rows) {
    if (!out[r.bid]) continue
    out[r.bid] = { selected: r.selected ?? [], correct: r.correct, attempts: r.attempts, submitted: true }
  }
  return out
}
