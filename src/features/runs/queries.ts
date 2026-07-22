import 'server-only'
import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import { db, runStepAssist, runStepState, runs, steps } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'

/** Опыт других прогонов шага для «помощи на шаге»: сколько прошло / застряло.
 *  Только счётчики (наш data moat) — чужие тексты причин НЕ выдаём (приватность note).
 *  excludeRunId — текущий прогон не считаем сам себе «опытом других». */
export async function stepStuckStats(stepId: string, excludeRunId: string): Promise<{ passed: number; stuck: number }> {
  const [row] = await db
    .select({
      passed: sql<number>`count(*) filter (where ${runStepState.status} = 'done')::int`,
      stuck: sql<number>`count(*) filter (where ${runStepState.status} = 'blocked')::int`,
    })
    .from(runStepState)
    .where(and(eq(runStepState.stepId, stepId), ne(runStepState.runId, excludeRunId)))
  return { passed: row?.passed ?? 0, stuck: row?.stuck ?? 0 }
}

/** То же пакетно по всем шагам версии — для проактивной подсветки
 *  «здесь часто застревают» на странице прогона (один запрос, не N). */
export async function versionStuckStats(versionId: string, excludeRunId: string): Promise<Map<string, { passed: number; stuck: number }>> {
  const rows = await db
    .select({
      stepId: runStepState.stepId,
      passed: sql<number>`count(*) filter (where ${runStepState.status} = 'done')::int`,
      stuck: sql<number>`count(*) filter (where ${runStepState.status} = 'blocked')::int`,
    })
    .from(runStepState)
    .innerJoin(steps, eq(steps.id, runStepState.stepId))
    .where(and(eq(steps.versionId, versionId), ne(runStepState.runId, excludeRunId)))
    .groupBy(runStepState.stepId)
  return new Map(rows.map((r) => [r.stepId, { passed: r.passed, stuck: r.stuck }]))
}

/** Нити диалога помощи прогона, сгруппированные по шагам (для страницы прогона). */
export async function getAssistThreads(runId: string): Promise<Map<string, { role: 'user' | 'assistant'; content: string }[]>> {
  const rows = await db
    .select({ stepId: runStepAssist.stepId, role: runStepAssist.role, content: runStepAssist.content })
    .from(runStepAssist)
    .where(eq(runStepAssist.runId, runId))
    .orderBy(runStepAssist.createdAt)
  const map = new Map<string, { role: 'user' | 'assistant'; content: string }[]>()
  for (const r of rows) {
    const arr = map.get(r.stepId) ?? []
    arr.push({ role: r.role, content: r.content })
    map.set(r.stepId, arr)
  }
  return map
}

/** Эффект «помощи на шаге» для админ-метрик: сколько шагов получали подсказку
 *  и сколько из них ПОСЛЕ неё дошли до done (unblock rate — аргумент ценности). */
export async function assistEffect(): Promise<{ hinted: number; unblocked: number }> {
  const [row] = await db
    .select({
      hinted: sql<number>`count(*)::int`,
      unblocked: sql<number>`count(*) filter (where ${runStepState.status} = 'done' and ${runStepState.doneAt} > ${runStepState.assistAt})::int`,
    })
    .from(runStepState)
    .where(isNotNull(runStepState.assistAt))
  return { hinted: row?.hinted ?? 0, unblocked: row?.unblocked ?? 0 }
}

export interface UserRunRow {
  id: string
  status: 'active' | 'done' | 'abandoned' | 'failed'
  version: number
  doneCount: number
  total: number
  updatedAt: Date
  handle: string
  slug: string
  title: LocaleText
}

/** Все прогоны пользователя (для страницы «Мои прогоны»), свежие сверху. */
export async function getUserRuns(userId: string): Promise<UserRunRow[]> {
  const rows = await db.query.runs.findMany({
    where: (r) => eq(r.userId, userId),
    with: { template: { with: { owner: true } } },
    orderBy: (r, { desc }) => desc(r.updatedAt),
  })
  if (rows.length === 0) return []
  // Кол-во шагов в версиях прогонов — одним запросом (без relation `version`,
  // чтобы не конфликтовать с одноимённой колонкой runs.version).
  const versionIds = [...new Set(rows.map((r) => r.versionId))]
  // total = только шаг-блоки (чекаемые); text/image в прогрессе не считаются.
  const counts = await db
    .select({ versionId: steps.versionId, c: sql<number>`count(*)::int` })
    .from(steps)
    .where(and(inArray(steps.versionId, versionIds), eq(steps.type, 'step')))
    .groupBy(steps.versionId)
  const totalByVersion = new Map(counts.map((c) => [c.versionId, c.c]))
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    version: r.version,
    doneCount: r.doneCount,
    total: totalByVersion.get(r.versionId) ?? 0,
    updatedAt: r.updatedAt,
    handle: r.template.owner.handle,
    slug: r.template.slug,
    title: r.template.title as LocaleText,
  }))
}

/** Прогон со всеми шагами версии и их состоянием. Только владельцу прогона. */
export async function getRun(runId: string, userId: string) {
  const run = await db.query.runs.findFirst({
    where: (r) => eq(r.id, runId),
    with: {
      template: { with: { owner: true } },
      version: { with: { steps: { orderBy: (s, { asc }) => asc(s.n) } } },
      stepStates: true,
    },
  })
  if (!run || run.userId !== userId) return null

  const stateByStep = new Map(run.stepStates.map((s) => [s.stepId, s]))
  return {
    run: { id: run.id, status: run.status, doneCount: run.doneCount, version: run.version, templateId: run.templateId, versionId: run.versionId },
    template: {
      handle: run.template.owner.handle,
      slug: run.template.slug,
      title: run.template.title,
      ordered: run.template.ordered,
    },
    steps: run.version.steps.map((s) => ({
      id: s.id,
      n: s.n,
      type: s.type,
      content: s.content,
      title: s.title,
      desc: s.desc,
      command: s.command,
      level: s.level,
      why: s.why,
      subtasks: s.subtasks,
      refs: s.refs,
      state: stateByStep.get(s.id) ?? null,
    })),
  }
}

/** Активный прогон пользователя по текущей версии списка (для кнопки «Продолжить»). */
export async function getActiveRunId(templateId: string, versionId: string, userId: string): Promise<string | null> {
  const [r] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(eq(runs.userId, userId), eq(runs.templateId, templateId), eq(runs.versionId, versionId), eq(runs.status, 'active')),
    )
    .limit(1)
  return r?.id ?? null
}
