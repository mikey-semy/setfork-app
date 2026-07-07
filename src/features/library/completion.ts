import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { courseCompletions, db, runStepState, steps } from '@/shared/db'

/**
 * Записать прохождение курса, если в прогоне отмечены done ВСЕ шаг-блоки версии.
 * Идемпотентно (unique user+tpl → onConflictDoNothing). Возвращает true, если
 * курс теперь считается пройденным (все шаги сделаны).
 *
 * Это «веха по прогону» — для чек-листов БЕЗ тестов (у курсов с тестами есть
 * свой путь в submitQuiz). Любой достигнутый первым путь фиксирует прохождение.
 */
export async function recordRunCompletionIfDone(
  userId: string,
  run: { id: string; templateId: string; versionId: string; version: number },
): Promise<boolean> {
  const [tot] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(steps)
    .where(and(eq(steps.versionId, run.versionId), eq(steps.type, 'step')))
  const total = tot?.c ?? 0
  if (!total) return false // курс без шаг-блоков — прогоном не завершается

  const [dn] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(runStepState)
    .where(and(eq(runStepState.runId, run.id), eq(runStepState.status, 'done')))
  if ((dn?.c ?? 0) < total) return false

  await db
    .insert(courseCompletions)
    .values({ templateId: run.templateId, userId, version: run.version })
    .onConflictDoNothing({ target: [courseCompletions.userId, courseCompletions.templateId] })
  return true
}
