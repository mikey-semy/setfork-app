'use server'

import { and, eq, sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { db, runStepState, runs, steps, templates } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { canViewList } from '@/core'
import { tr, type LocaleText } from '@/shared/i18n'
import { collabStore } from '@/features/collab-store/store'
import { isCollaborator } from '@/features/collab/queries'
import { recordRunCompletionIfDone } from '@/features/library/completion'

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
  // Коллаборатор — «свой» для приватного/черновика (ведут вместе), как canViewList.
  // Считаем лениво: только если это могло бы заблокировать не-владельца.
  const maintainer =
    isOwner ||
    ((tpl.visibility === 'private' || tpl.status === 'draft') && (await isCollaborator(tpl.id, session.userId)))
  if (tpl.visibility === 'private' && !maintainer) return
  if (tpl.status === 'draft' && !maintainer) return
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
    // Чекаются только шаг-блоки; text/image — контекст, состояние прогона им не нужно.
    const stepRows = await db.select({ id: steps.id }).from(steps).where(and(eq(steps.versionId, cur.id), eq(steps.type, 'step')))
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
  // Отметили шаг → возможно, пройдены все шаги курса (веха прохождения).
  if (next === 'done') await recordRunCompletionIfDone(session.userId, run)
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
  // Завершение прогона со всеми сделанными шагами = прохождение курса.
  await recordRunCompletionIfDone(session.userId, run)
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

/** Полностью удалить прогон (и его состояние шагов — каскадом). Необратимо. */
export async function deleteRun(runId: string): Promise<void> {
  const session = await requireSession()
  const run = await ownedRun(runId, session.userId)
  if (!run) return
  await db.delete(runs).where(eq(runs.id, runId)) // run_step_state удалится по ON DELETE CASCADE
  redirect('/runs')
}

// ── Неудачный путь: заблокировать шаг (не получилось) + причина ───────
export async function blockStep(runId: string, stepId: string, reason: string): Promise<void> {
  const session = await requireSession()
  const run = await ownedRun(runId, session.userId)
  if (!run) return
  const [st] = await db
    .select({ id: runStepState.id })
    .from(runStepState)
    .where(and(eq(runStepState.runId, runId), eq(runStepState.stepId, stepId)))
    .limit(1)
  if (!st) return
  await db
    .update(runStepState)
    .set({ status: 'blocked', note: reason.trim().slice(0, 500), doneAt: null })
    .where(eq(runStepState.id, st.id))
  await recountDone(runId) // blocked ≠ done → счётчик пересчитываем
  revalidatePath(`/runs/${runId}`)
}

/** Снять блокировку шага (обратно в todo, причина очищается). */
export async function unblockStep(runId: string, stepId: string): Promise<void> {
  const session = await requireSession()
  const run = await ownedRun(runId, session.userId)
  if (!run) return
  const [st] = await db
    .select({ id: runStepState.id })
    .from(runStepState)
    .where(and(eq(runStepState.runId, runId), eq(runStepState.stepId, stepId)))
    .limit(1)
  if (!st) return
  await db.update(runStepState).set({ status: 'todo', note: '' }).where(eq(runStepState.id, st.id))
  revalidatePath(`/runs/${runId}`)
}

/** Завершить прогон с исходом «неудача» (в отличие от done/abandoned). */
export async function failRun(runId: string): Promise<void> {
  const session = await requireSession()
  const run = await ownedRun(runId, session.userId)
  if (!run) return
  await db.update(runs).set({ status: 'failed', updatedAt: new Date() }).where(eq(runs.id, runId))
  revalidatePath(`/runs/${runId}`)
}

// ── Петля обратной связи: заблокированный шаг → issue на список ───────
export async function reportBlockedStep(runId: string, stepId: string): Promise<void> {
  const session = await requireSession()
  const run = await db.query.runs.findFirst({
    where: (r) => eq(r.id, runId),
    with: { template: { with: { owner: true } } },
  })
  if (!run || run.userId !== session.userId) return
  const tpl = run.template
  // issue открываем только там, где список доступен пишущему: свой, либо публичный+
  // активный. Раньше проверялась только модерация — приватный список (ставший приватным
  // после старта прогона) пропускался. canViewList закрывает private/draft/moderation.
  const isOwner = tpl.ownerId === session.userId
  if (!canViewList(tpl, { isOwner })) redirect(`/runs/${runId}`)

  const [st] = await db
    .select({ n: steps.n, title: steps.title, state: runStepState.note })
    .from(steps)
    .leftJoin(runStepState, and(eq(runStepState.stepId, steps.id), eq(runStepState.runId, runId)))
    .where(eq(steps.id, stepId))
    .limit(1)
  if (!st) redirect(`/runs/${runId}`)

  const stepTitle = tr(st.title as LocaleText, 'en') || `#${st.n}`
  const reason = (st.state ?? '').trim()
  const title = `Run blocked at step ${st.n}: ${stepTitle}`.slice(0, 200)
  const body =
    `Reported from a run of **v${run.version}**.\n\n` +
    `**Step ${st.n}: ${stepTitle}** could not be completed.` +
    (reason ? `\n\n**What went wrong:** ${reason}` : '')

  const ins = await collabStore.openIssue(tpl.id, session.userId, title, body.slice(0, 20000), ['bug'])
  redirect(`/${tpl.owner.handle}/${tpl.slug}/issues/${ins.number}`)
}
