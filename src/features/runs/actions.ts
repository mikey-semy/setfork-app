'use server'

import { and, eq, sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { db, runStepState, runs, steps, templates } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'

async function ownedRun(runId: string, userId: string) {
  const run = await db.query.runs.findFirst({ where: (r) => eq(r.id, runId) })
  return run && run.userId === userId ? run : null
}

async function recountDone(runId: string): Promise<void> {
  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(runStepState)
    .where(and(eq(runStepState.runId, runId), eq(runStepState.status, 'done')))
  await db.update(runs).set({ doneCount: c, updatedAt: new Date() }).where(eq(runs.id, runId))
}

// ── Старт/возобновление прогона по текущей версии списка ─────────────
export async function startRun(templateId: string): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({
    where: (t) => eq(t.id, templateId),
    with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
  })
  if (!tpl) return
  const isOwner = tpl.ownerId === session.userId
  if (tpl.visibility === 'private' && !isOwner) return
  if (tpl.status === 'draft' && !isOwner) return
  if (tpl.moderation !== 'active' && !isOwner) return

  const cur = tpl.versions.find((v) => v.version === tpl.currentVersion) ?? tpl.versions[0]
  if (!cur) return

  // Уже есть активный прогон по этой версии → продолжаем его.
  const existing = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(eq(runs.userId, session.userId), eq(runs.templateId, tpl.id), eq(runs.versionId, cur.id), eq(runs.status, 'active')),
    )
    .limit(1)
  let runId = existing[0]?.id

  if (!runId) {
    const [r] = await db
      .insert(runs)
      .values({ templateId: tpl.id, versionId: cur.id, version: cur.version, userId: session.userId })
      .returning()
    runId = r.id
    const stepRows = await db.select({ id: steps.id }).from(steps).where(eq(steps.versionId, cur.id))
    if (stepRows.length) await db.insert(runStepState).values(stepRows.map((s) => ({ runId: r.id, stepId: s.id })))
    await db.update(templates).set({ runsCount: sql`${templates.runsCount} + 1` }).where(eq(templates.id, tpl.id))
  }
  redirect(`/runs/${runId}`)
}

// ── Отметить/снять шаг ────────────────────────────────────────────────
export async function toggleStep(runId: string, stepId: string): Promise<void> {
  const session = await requireSession()
  const run = await ownedRun(runId, session.userId)
  if (!run) return
  const [st] = await db
    .select()
    .from(runStepState)
    .where(and(eq(runStepState.runId, runId), eq(runStepState.stepId, stepId)))
    .limit(1)
  if (!st) return
  const next = st.status === 'done' ? 'todo' : 'done'
  await db
    .update(runStepState)
    .set({ status: next, doneAt: next === 'done' ? new Date() : null })
    .where(eq(runStepState.id, st.id))
  await recountDone(runId)
}

// ── Отметить/снять подпункт (по индексу) ──────────────────────────────
export async function toggleSubtask(runId: string, stepId: string, idx: number): Promise<void> {
  const session = await requireSession()
  const run = await ownedRun(runId, session.userId)
  if (!run) return
  const [st] = await db
    .select()
    .from(runStepState)
    .where(and(eq(runStepState.runId, runId), eq(runStepState.stepId, stepId)))
    .limit(1)
  if (!st) return
  const set = new Set(st.subtasksDone)
  set.has(idx) ? set.delete(idx) : set.add(idx)
  await db
    .update(runStepState)
    .set({ subtasksDone: [...set].sort((a, b) => a - b) })
    .where(eq(runStepState.id, st.id))
  await db.update(runs).set({ updatedAt: new Date() }).where(eq(runs.id, runId))
}

// ── Завершить / бросить прогон ────────────────────────────────────────
export async function finishRun(runId: string): Promise<void> {
  const session = await requireSession()
  const run = await ownedRun(runId, session.userId)
  if (!run) return
  await db.update(runs).set({ status: 'done', updatedAt: new Date() }).where(eq(runs.id, runId))
  revalidatePath(`/runs/${runId}`)
}

export async function reopenRun(runId: string): Promise<void> {
  const session = await requireSession()
  const run = await ownedRun(runId, session.userId)
  if (!run) return
  await db.update(runs).set({ status: 'active', updatedAt: new Date() }).where(eq(runs.id, runId))
  revalidatePath(`/runs/${runId}`)
}

export async function abandonRun(runId: string): Promise<void> {
  const session = await requireSession()
  const run = await ownedRun(runId, session.userId)
  if (!run) return
  await db.update(runs).set({ status: 'abandoned', updatedAt: new Date() }).where(eq(runs.id, runId))
  // Возвращаемся к самому списку (отдельной страницы «Мои прогоны» нет).
  const back = await db.query.runs.findFirst({
    where: (r) => eq(r.id, runId),
    with: { template: { with: { owner: true } } },
  })
  redirect(back ? `/${back.template.owner.handle}/${back.template.slug}` : '/explore')
}
