import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import { db, runs, runStepState, templates, users } from '@/shared/db'

/** Активный (или последний) прогон пользователя по шаблону + состояния шагов. */
export async function getActiveRun(templateId: string, userId: string) {
  const run = await db.query.runs.findFirst({
    where: (r) => and(eq(r.templateId, templateId), eq(r.userId, userId)),
    orderBy: (r) => desc(r.startedAt),
  })
  if (!run) return null
  const states = await db.select().from(runStepState).where(eq(runStepState.runId, run.id))
  const byStep = new Map(states.map((s) => [s.stepId, s]))
  return { run, byStep }
}

/** Прогоны пользователя для страницы /runs. */
export async function getUserRuns(userId: string) {
  return db
    .select({
      id: runs.id,
      status: runs.status,
      doneCount: runs.doneCount,
      version: runs.version,
      startedAt: runs.startedAt,
      updatedAt: runs.updatedAt,
      ownerHandle: users.handle,
      slug: templates.slug,
      titleEn: templates.titleEn,
      titleRu: templates.titleRu,
    })
    .from(runs)
    .innerJoin(templates, eq(runs.templateId, templates.id))
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(eq(runs.userId, userId))
    .orderBy(desc(runs.updatedAt))
}
