import 'server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db, runStepState, runs, steps, templates, users } from '@/shared/db'

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
    run: { id: run.id, status: run.status, doneCount: run.doneCount, version: run.version },
    template: {
      handle: run.template.owner.handle,
      slug: run.template.slug,
      title: run.template.title,
      ordered: run.template.ordered,
    },
    steps: run.version.steps.map((s) => ({
      id: s.id,
      n: s.n,
      title: s.title,
      desc: s.desc,
      command: s.command,
      subtasks: s.subtasks,
      refs: s.refs,
      state: stateByStep.get(s.id) ?? null,
    })),
  }
}

export interface RunListItem {
  id: string
  handle: string
  slug: string
  title: typeof templates.$inferSelect.title
  status: 'active' | 'done' | 'abandoned'
  doneCount: number
  total: number
  version: number
  updatedAt: Date
}

/** Прогоны пользователя с прогрессом. */
export async function getUserRuns(userId: string): Promise<RunListItem[]> {
  const rows = await db
    .select({
      id: runs.id,
      handle: users.handle,
      slug: templates.slug,
      title: templates.title,
      status: runs.status,
      doneCount: runs.doneCount,
      total: sql<number>`(select count(*)::int from ${runStepState} where ${runStepState.runId} = ${runs.id})`,
      version: runs.version,
      updatedAt: runs.updatedAt,
    })
    .from(runs)
    .innerJoin(templates, eq(runs.templateId, templates.id))
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(eq(runs.userId, userId))
    .orderBy(desc(runs.updatedAt))
  return rows as RunListItem[]
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
