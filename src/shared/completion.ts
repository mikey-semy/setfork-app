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

  // Один проход по блокам: и счёт шагов, и сбор идентификаторов тестов.
  let stepCount = 0
  const quizBids: string[] = []
  for (const b of blocks) {
    if (b.type === 'step') stepCount++
    else if (b.type === 'quiz') {
      const bid = (b.content as { bid?: string }).bid
      if (bid) quizBids.push(bid)
    }
  }

  if (!stepCount && !quizBids.length) return false // нечего проходить

  // Шаги: все шаг-блоки версии отмечены В ОДНОМ прогоне.
  //
  // Считать «сколько done у пользователя на этой версии» нельзя: человек может
  // бросить наполовину пройденный прогон и начать новый — тогда два неполных прогона
  // складываются в «полный», и курс засчитывается, хотя ни один прогон не пройден
  // целиком. Отметки одного и того же шага в разных прогонах суммировались бы так же.
  // Поэтому группируем по прогону и требуем, чтобы нашёлся хотя бы один, где отмечено
  // нужное число РАЗНЫХ шагов.
  if (stepCount) {
    const perRun = await db
      .select({ runId: runStepState.runId, c: sql<number>`count(distinct ${runStepState.stepId})::int` })
      .from(runStepState)
      .innerJoin(runs, eq(runs.id, runStepState.runId))
      .where(and(eq(runs.userId, userId), eq(runs.versionId, version.versionId), eq(runStepState.status, 'done')))
      .groupBy(runStepState.runId)
    if (!perRun.some((r) => (r.c ?? 0) >= stepCount)) return false
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
