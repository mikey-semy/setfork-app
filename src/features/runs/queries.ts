import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, runs } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'

export interface UserRunRow {
  id: string
  status: 'active' | 'done' | 'abandoned'
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
    with: {
      template: { with: { owner: true } },
      version: { with: { steps: { columns: { id: true } } } },
    },
    orderBy: (r, { desc }) => desc(r.updatedAt),
  })
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    version: r.version,
    doneCount: r.doneCount,
    total: r.version.steps.length,
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
