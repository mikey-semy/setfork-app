'use server'

import { and, asc, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  db,
  runs,
  runStepState,
  steps,
  templateVersions,
  templates,
  users,
} from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { getTemplateDetail } from '@/features/library/queries'

// ── Запуск прогона ────────────────────────────────────────────────────
export async function startRun(ownerHandle: string, slug: string): Promise<void> {
  const session = await requireSession()
  const detail = await getTemplateDetail(ownerHandle, slug)
  if (!detail || !detail.currentVersion) return
  const { tpl, currentVersion, steps: stepRows } = detail

  const [run] = await db
    .insert(runs)
    .values({
      templateId: tpl.id,
      versionId: currentVersion.id,
      version: currentVersion.version,
      userId: session.userId,
    })
    .returning()

  if (stepRows.length) {
    await db.insert(runStepState).values(
      stepRows.map((s, i) => ({
        runId: run.id,
        stepId: s.id,
        status: (i === 0 ? 'cur' : 'todo') as 'cur' | 'todo',
      })),
    )
  }

  await db
    .update(templates)
    .set({ runsCount: sql`${templates.runsCount} + 1` })
    .where(eq(templates.id, tpl.id))

  revalidatePath(`/${ownerHandle}/${slug}`)
}

// ── Отметить шаг выполненным (и продвинуть текущий) ──────────────────
export async function markStepDone(runId: string, stepId: string): Promise<void> {
  const session = await requireSession()
  const run = await db.query.runs.findFirst({ where: (r) => eq(r.id, runId) })
  if (!run || run.userId !== session.userId) return

  await db
    .update(runStepState)
    .set({ status: 'done', doneAt: new Date() })
    .where(and(eq(runStepState.runId, runId), eq(runStepState.stepId, stepId)))

  // Порядок шагов версии.
  const versionSteps = await db
    .select({ id: steps.id })
    .from(steps)
    .where(eq(steps.versionId, run.versionId))
    .orderBy(asc(steps.n))

  const states = await db.select().from(runStepState).where(eq(runStepState.runId, runId))
  const statusById = new Map(states.map((s) => [s.stepId, s.status]))

  // Следующий невыполненный шаг → 'cur', остальные не-done → 'todo'.
  let nextCurAssigned = false
  for (const s of versionSteps) {
    const st = statusById.get(s.id)
    if (st === 'done') continue
    if (!nextCurAssigned) {
      await db
        .update(runStepState)
        .set({ status: 'cur' })
        .where(and(eq(runStepState.runId, runId), eq(runStepState.stepId, s.id)))
      nextCurAssigned = true
    } else if (st === 'cur') {
      await db
        .update(runStepState)
        .set({ status: 'todo' })
        .where(and(eq(runStepState.runId, runId), eq(runStepState.stepId, s.id)))
    }
  }

  const doneCount = states.filter((s) => s.stepId === stepId || s.status === 'done').length
  const allDone = doneCount >= versionSteps.length
  await db
    .update(runs)
    .set({ doneCount, status: allDone ? 'done' : 'active', updatedAt: new Date() })
    .where(eq(runs.id, runId))

  revalidatePath('/', 'layout')
}

// ── Переключить подшаг ────────────────────────────────────────────────
export async function toggleSubtask(runId: string, stepId: string, index: number): Promise<void> {
  const session = await requireSession()
  const run = await db.query.runs.findFirst({ where: (r) => eq(r.id, runId) })
  if (!run || run.userId !== session.userId) return

  const [state] = await db
    .select()
    .from(runStepState)
    .where(and(eq(runStepState.runId, runId), eq(runStepState.stepId, stepId)))
    .limit(1)
  if (!state) return

  const set = new Set(state.subtasksDone)
  if (set.has(index)) set.delete(index)
  else set.add(index)

  await db
    .update(runStepState)
    .set({ subtasksDone: [...set].sort((a, b) => a - b) })
    .where(and(eq(runStepState.runId, runId), eq(runStepState.stepId, stepId)))

  revalidatePath('/', 'layout')
}

// ── Сохранить заметку к шагу ─────────────────────────────────────────
export async function saveNote(runId: string, stepId: string, note: string): Promise<void> {
  const session = await requireSession()
  const run = await db.query.runs.findFirst({ where: (r) => eq(r.id, runId) })
  if (!run || run.userId !== session.userId) return
  await db
    .update(runStepState)
    .set({ note })
    .where(and(eq(runStepState.runId, runId), eq(runStepState.stepId, stepId)))
}

// ── Форк шаблона в пространство текущего пользователя ─────────────────
export async function forkTemplate(templateId: string): Promise<void> {
  const session = await requireSession()
  const src = await db.query.templates.findFirst({
    where: (t) => eq(t.id, templateId),
    with: { versions: { orderBy: (v, { desc: d }) => d(v.version) } },
  })
  if (!src) return

  // Уникальный slug в пространстве пользователя.
  const owned = await db
    .select({ slug: templates.slug })
    .from(templates)
    .where(and(eq(templates.ownerId, session.userId), eq(templates.slug, src.slug)))
  const slug = owned.length ? `${src.slug}-fork` : src.slug

  const [fork] = await db
    .insert(templates)
    .values({
      ownerId: session.userId,
      slug,
      title: src.title,
      desc: src.desc,
      topicId: src.topicId,
      currentVersion: 1,
      origin: 'forked',
      forkedFromId: src.id,
    })
    .returning()

  // Копируем текущую версию как v1 форка + её шаги.
  const srcCurrent = src.versions.find((v) => v.version === src.currentVersion) ?? src.versions[0]
  const [ver] = await db
    .insert(templateVersions)
    .values({ templateId: fork.id, version: 1, note: `forked from ${src.slug} v${srcCurrent?.version ?? 1}` })
    .returning()

  if (srcCurrent) {
    const srcSteps = await db
      .select()
      .from(steps)
      .where(eq(steps.versionId, srcCurrent.id))
      .orderBy(asc(steps.n))
    if (srcSteps.length) {
      await db.insert(steps).values(
        srcSteps.map((s) => ({
          versionId: ver.id,
          n: s.n,
          title: s.title,
          desc: s.desc,
          command: s.command,
          hasImage: s.hasImage,
          subtasks: s.subtasks,
          refs: s.refs,
        })),
      )
    }
  }

  await db
    .update(templates)
    .set({ forksCount: sql`${templates.forksCount} + 1` })
    .where(eq(templates.id, src.id))

  const [owner] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, session.userId))
  revalidatePath('/explore')
  redirect(`/${owner.handle}/${slug}`)
}
