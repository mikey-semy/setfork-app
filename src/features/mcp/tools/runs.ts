import 'server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db, runs, runStepState, steps, templates, templateVersions, users } from '@/shared/db'
import { tr } from '@/shared/i18n'
import { resolveListRefOrMoved } from './shared'
import { canViewList } from '@/core'
import { recordAgentAction } from '@/shared/agents/policy'
import { recordRunCompletionIfDone } from '@/shared/completion'
import { getCourseCompletion } from '@/features/quizzes/queries'
// eslint-disable-next-line no-restricted-imports -- MCP: доступ по userId токена (нет cookie-сессии), mcpCanView стоит у каждого вызова
import { getTemplateDetail } from '@/features/library/queries'
import { detailByRefOrMoved, mcpCanView } from './shared'

/**
 * Прогоны списка через MCP: запустить, посмотреть состояние, отметить шаг.
 *
 * Отдельно от инструментов правки: у прогона своя причина меняться — что считается
 * выполненным шагом и когда прогон закрывается, — и он единственный трогает
 * `runStepState` и учёт прохождения курса.
 */

// ── Прогоны (runs): запуск/просмотр/отметка шагов через MCP ──────────
// Логика зеркалит features/runs, но принимает userId из токена (не session).

/** Состояние прогона: список шагов с отметками + прогресс. */
async function mcpRunState(userId: string, runId: string) {
  const run = await db.query.runs.findFirst({ where: (r) => eq(r.id, runId) })
  if (!run || run.userId !== userId) return { error: 'run not found' }
  // Только шаг-блоки, перенумерованные 1..K (индекс среди шагов) — это и есть N
  // для check_step. text/image в прогон не входят. Три независимых чтения — параллельно.
  const [[meta], stepRows, states] = await Promise.all([
    db
      .select({ slug: templates.slug, ownerHandle: users.handle })
      .from(templates)
      .innerJoin(users, eq(users.id, templates.ownerId))
      .where(eq(templates.id, run.templateId))
      .limit(1),
    db.select({ id: steps.id, title: steps.title }).from(steps).where(and(eq(steps.versionId, run.versionId), eq(steps.type, 'step'))).orderBy(steps.n),
    db.select({ stepId: runStepState.stepId, status: runStepState.status, note: runStepState.note }).from(runStepState).where(eq(runStepState.runId, runId)),
  ])
  const byStep = new Map(states.map((s) => [s.stepId, s]))
  const stepsOut = stepRows.map((s, i) => {
    const st = byStep.get(s.id)
    return {
      n: i + 1,
      title: tr(s.title, 'en'),
      done: st?.status === 'done',
      blocked: st?.status === 'blocked',
      reason: st?.status === 'blocked' && st.note ? st.note : undefined,
    }
  })
  const completion = await getCourseCompletion(run.templateId, userId)
  return {
    runId,
    ref: meta ? `${meta.ownerHandle}/${meta.slug}` : undefined,
    version: run.version,
    status: run.status,
    progress: { done: stepsOut.filter((s) => s.done).length, total: stepsOut.length },
    // Курс пройден (веха): все шаги отмечены (или пройдены все тесты списка).
    courseCompleted: !!completion,
    steps: stepsOut,
  }
}

/** Запустить (или продолжить активный) прогон списка по текущей версии. */
export async function mcpStartRun(userId: string, handle: string, slug: string) {
  const detail = await detailByRefOrMoved(handle, slug)
  if (!detail) return { error: 'list not found' }
  const { tpl, currentVersion } = detail
  if (!(await mcpCanView(tpl, userId))) return { error: 'forbidden' }
  const cur = currentVersion
  if (!cur) return { error: 'list has no version' }

  const existing = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.userId, userId), eq(runs.templateId, tpl.id), eq(runs.versionId, cur.id), eq(runs.status, 'active')))
    .limit(1)
  let runId = existing[0]?.id
  if (!runId) {
    const [r] = await db.insert(runs).values({ templateId: tpl.id, versionId: cur.id, version: cur.version, userId }).returning()
    runId = r.id
    // Чекаются только шаг-блоки; text/image — контекст, состояние им не заводим.
    const stepRows = await db.select({ id: steps.id }).from(steps).where(and(eq(steps.versionId, cur.id), eq(steps.type, 'step')))
    if (stepRows.length) await db.insert(runStepState).values(stepRows.map((s) => ({ runId: r.id, stepId: s.id })))
    await db.update(templates).set({ runsCount: sql`${templates.runsCount} + 1` }).where(eq(templates.id, tpl.id))
  }
  return mcpRunState(userId, runId)
}

/** Текущее состояние прогона по его id. */
export async function mcpGetRun(userId: string, runId: string) {
  return mcpRunState(userId, runId)
}

/**
 * Отметить шаг прогона по номеру N (CI-стиль для агента):
 * blocked=true → «упал» + причина; done=true/false → выполнен/нет; иначе — тоггл done.
 */
export async function mcpCheckStep(userId: string, runId: string, stepN: number, opts?: { done?: boolean; blocked?: boolean; reason?: string }) {
  const run = await db.query.runs.findFirst({ where: (r) => eq(r.id, runId) })
  if (!run || run.userId !== userId) return { error: 'run not found' }
  // N — индекс среди ШАГ-блоков (1..K), а не steps.n (тот включает text/image).
  const stepBlocks = await db.select({ id: steps.id }).from(steps).where(and(eq(steps.versionId, run.versionId), eq(steps.type, 'step'))).orderBy(steps.n)
  const st = stepBlocks[stepN - 1]
  if (!st) return { error: 'step not found' }
  const [state] = await db.select().from(runStepState).where(and(eq(runStepState.runId, runId), eq(runStepState.stepId, st.id))).limit(1)
  if (!state) return { error: 'step state not found' }

  if (opts?.blocked) {
    await db
      .update(runStepState)
      .set({ status: 'blocked', note: (opts.reason ?? '').trim().slice(0, 500), doneAt: null })
      .where(eq(runStepState.id, state.id))
  } else {
    const target = opts?.done === undefined ? (state.status === 'done' ? 'todo' : 'done') : opts.done ? 'done' : 'todo'
    await db.update(runStepState).set({ status: target, note: '', doneAt: target === 'done' ? new Date() : null }).where(eq(runStepState.id, state.id))
  }
  // Пересчёт doneCount (зеркало runs/actions.recountDone).
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(runStepState)
    .where(and(eq(runStepState.runId, runId), eq(runStepState.status, 'done')))
  await db.update(runs).set({ doneCount: c, updatedAt: new Date() }).where(eq(runs.id, runId))
  // Все шаги отмечены → фиксируем прохождение курса (та же веха, что на сайте).
  await recordRunCompletionIfDone(userId, run)
  return mcpRunState(userId, runId)
}

/**
 * ЗАПИСАТЬ ОТЧЁТ О ПРОГОНЕ версии — вход для внешнего прогонщика.
 *
 * Песочница живёт ВНЕ прода: исполнять чужие скрипты в прод-контейнере нельзя, это
 * граница безопасности, а не оптимизация. Прод получает только результат — через этот
 * инструмент.
 *
 * ⚠️ `runId` ОБЯЗАТЕЛЕН, и это не формальность. Отчёт называется воспроизводимым фактом;
 * без прогона он превращается в утверждение «я это проверил», ничем не подкреплённое.
 * Прогон существует, принадлежит тому же списку и той же версии — иначе отчёт
 * рассказывал бы про одну версию, ссылаясь на прогон другой.
 *
 * ⚠️ `kind` ЗАФИКСИРОВАН МАШИННЫМ. Ручной уровень ставится ручкой в настройках списка,
 * и позволить агенту записать `manual` значило бы дать ему выдать машинный прогон за
 * человеческий — ровно то, что запрещает правило 5 спеки.
 */
export async function mcpReportRun(
  userId: string,
  input: {
    list: string
    runId: string
    task: string
    environment: Record<string, string>
    steps: { n: number; status: 'pass' | 'fail' | 'skip'; note?: string }[]
    verdict: 'works' | 'works_with_caveats' | 'fails'
    notes?: string
  },
) {
  const { recordVerificationReport } = await import('@/features/library/verification-report')
  const { isCollaborator } = await import('@/features/collab/queries')

  // Ссылку разбирает ОБЩИЙ резолвер — тот же, что у остальных инструментов: он знает и
  // про «handle/slug», и про голый slug, и про переехавшие адреса. Свой разбор здесь
  // был бы четвёртой копией правила и разошёлся бы на первом же переименовании.
  const tpl = await resolveListRefOrMoved(input.list)
  if (!tpl) return { error: 'list not found' }
  // Отчёт — публичное утверждение о ЧУЖОМ списке, если его пишет посторонний. Право то
  // же, что у постановки уровня: отвечает за метку тот, кто список ведёт.
  if (tpl.ownerId !== userId && !(await isCollaborator(tpl.id, userId))) return { error: 'forbidden' }

  const [run] = await db
    .select({ id: runs.id, versionId: runs.versionId, templateId: runs.templateId, version: templateVersions.version })
    .from(runs)
    .innerJoin(templateVersions, eq(templateVersions.id, runs.versionId))
    .where(and(eq(runs.id, input.runId), eq(runs.templateId, tpl.id)))
    .limit(1)
  if (!run) return { error: 'run not found for this list — report must reference a real run' }

  const res = await recordVerificationReport({
    templateId: tpl.id,
    versionId: run.versionId,
    runId: run.id,
    kind: 'machine',
    task: input.task,
    environment: input.environment,
    steps: input.steps,
    verdict: input.verdict,
    notes: input.notes,
    runnerId: userId,
  })
  // ⚠️ ГОВОРИМ, ЕСЛИ ПРОГОН БЫЛ НЕ ПО ПОСЛЕДНЕЙ ВЕРСИИ. Отчёт правильно ложится на СВОЮ
  // версию и правильно поднимает ЕЁ уровень — «отчёт принадлежит версии» цел. Но список
  // за это время мог уйти вперёд: агент прогнал v3, автор внёс правку, и на самом списке
  // не меняется ничего. Запрещать такой отчёт нельзя (он честный), молчать — тоже:
  // агент решил бы, что поручился за текущее состояние. Поэтому сообщаем факт, а
  // решение оставляем ему.
  const stale = run.version !== tpl.currentVersion
  return {
    reportId: res.id,
    raisedLevel: res.raisedLevel,
    verdict: input.verdict,
    reportedVersion: run.version,
    currentVersion: tpl.currentVersion,
    ...(stale
      ? { staleVersion: true, note: `This run was on v${run.version}; the list is now v${tpl.currentVersion}. The report belongs to v${run.version} and does not vouch for the current one.` }
      : {}),
  }
}
