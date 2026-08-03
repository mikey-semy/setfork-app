import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { courseCompletions, db, quizAttempts, runStepState, runs, steps } from '@/shared/db'

/**
 * ЕДИНОЕ определение «курс версии пройден». Раньше их было два, и они не знали друг
 * о друге: путь прогона считал только шаг-блоки, путь тестов — только quiz-блоки.
 * На версии, где есть и то и другое, любой из них выдавал прохождение в одиночку —
 * то есть сертификат можно было получить, отметив шаги и не открыв ни одного теста
 * (и наоборот). Докстрока прежнего пути честно говорила «для списков БЕЗ тестов», но
 * ничто не мешало ему сработать на смешанной версии.
 *
 * Правило: выполнены обе стороны, которые в версии есть. Отсутствующая сторона
 * считается выполненной (курс из одних тестов, список из одних шагов), пустая версия
 * прохождением не считается вовсе.
 */
export async function isCourseCompleted(
  userId: string,
  version: { templateId: string; versionId: string },
): Promise<boolean> {
  const blocks = await db
    .select({ type: steps.type, content: steps.content })
    .from(steps)
    .where(eq(steps.versionId, version.versionId))

  const stepCount = blocks.filter((b) => b.type === 'step').length
  const quizBids = blocks
    .filter((b) => b.type === 'quiz')
    .map((b) => (b.content as { bid?: string }).bid)
    .filter((b): b is string => !!b)

  if (!stepCount && !quizBids.length) return false // нечего проходить

  // Шаги: нужен прогон ЭТОЙ версии, где отмечены все шаг-блоки.
  if (stepCount) {
    const [done] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(runStepState)
      .innerJoin(runs, eq(runs.id, runStepState.runId))
      .where(and(eq(runs.userId, userId), eq(runs.versionId, version.versionId), eq(runStepState.status, 'done')))
    if ((done?.c ?? 0) < stepCount) return false
  }

  // Тесты: по каждому quiz-блоку версии нужна успешная попытка.
  if (quizBids.length) {
    const passed = await db
      .select({ bid: quizAttempts.bid })
      .from(quizAttempts)
      .where(
        and(
          eq(quizAttempts.userId, userId),
          eq(quizAttempts.templateId, version.templateId),
          eq(quizAttempts.correct, true),
          inArray(quizAttempts.bid, quizBids),
        ),
      )
    const ok = new Set(passed.map((r) => r.bid))
    if (!quizBids.every((b) => ok.has(b))) return false
  }

  return true
}

/**
 * Записать прохождение курса, если версия пройдена целиком. Идемпотентно
 * (unique user+tpl → onConflictDoNothing). Возвращает true, если курс теперь
 * считается пройденным.
 *
 * Зовётся из ОБОИХ путей — отметки шага в прогоне и сдачи теста, — потому что на
 * смешанной версии последним может оказаться любой из них.
 */
export async function recordCompletionIfDone(
  userId: string,
  version: { templateId: string; versionId: string; version: number },
): Promise<boolean> {
  if (!(await isCourseCompleted(userId, version))) return false

  await db
    .insert(courseCompletions)
    .values({ templateId: version.templateId, userId, version: version.version })
    .onConflictDoNothing({ target: [courseCompletions.userId, courseCompletions.templateId] })
  return true
}

/** Прежнее имя точки входа пути прогона — вызывающие не переписываем. */
export const recordRunCompletionIfDone = recordCompletionIfDone
