import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { courseCompletions, db, quizAttempts, runStepState, runs, steps, templates, templateVersions, users } from '@/shared/db'
import { isCourseCompleted, recordCompletionIfDone } from '@/shared/completion'

/**
 * «Курс пройден» определялось ДВАЖДЫ и в двух местах по-разному: путь прогона считал
 * только шаг-блоки, путь тестов — только quiz-блоки. На версии, где есть и то и другое,
 * каждый из них выдавал прохождение в одиночку: сертификат можно было получить, отметив
 * шаги и не открыв ни одного теста, — и наоборот.
 *
 * Здесь закрепляется одно правило на оба пути: выполнены обе стороны, которые в версии
 * есть; отсутствующая сторона выполненной считается.
 */
const OWNER = 'cc-owner'
const ctx: Record<string, string> = {}

async function makeVersion(slug: string, blocks: { type: string; content?: unknown }[]) {
  const [t] = await db
    .insert(templates)
    .values({ ownerId: ctx.owner, slug, title: { en: slug }, currentVersion: 1 })
    .returning({ id: templates.id })
  const [v] = await db
    .insert(templateVersions)
    .values({ templateId: t.id, version: 1, note: 'v1' })
    .returning({ id: templateVersions.id })
  let n = 0
  for (const b of blocks) {
    n++
    await db.insert(steps).values({
      versionId: v.id,
      n,
      type: b.type,
      content: (b.content ?? {}) as Record<string, unknown>,
      title: { en: `${b.type}-${n}` },
    })
  }
  return { templateId: t.id, versionId: v.id, version: 1 }
}

/** Прогон пользователя с отметкой всех шаг-блоков версии. */
async function markAllSteps(versionId: string, templateId: string) {
  const [r] = await db
    .insert(runs)
    .values({ templateId, versionId, version: 1, userId: ctx.user })
    .returning({ id: runs.id })
  const rows = await db.select({ id: steps.id, type: steps.type }).from(steps).where(eq(steps.versionId, versionId))
  for (const s of rows.filter((x) => x.type === 'step')) {
    await db.insert(runStepState).values({ runId: r.id, stepId: s.id, status: 'done' })
  }
}

beforeEach(async () => {
  await db.delete(users).where(eq(users.handle, OWNER))
  await db.delete(users).where(eq(users.handle, `${OWNER}-learner`))
  const [o] = await db.insert(users).values({ handle: OWNER, name: OWNER }).returning({ id: users.id })
  const [u] = await db.insert(users).values({ handle: `${OWNER}-learner`, name: 'learner' }).returning({ id: users.id })
  ctx.owner = o.id
  ctx.user = u.id
})

describe('смешанная версия: шаги и тесты вместе', () => {
  const mixed = () => [{ type: 'step' }, { type: 'step' }, { type: 'quiz', content: { bid: 'q1' } }]

  it('все шаги отмечены, тест не сдан — курс НЕ пройден', async () => {
    const v = await makeVersion('mixed-a', mixed())
    await markAllSteps(v.versionId, v.templateId)

    expect(await isCourseCompleted(ctx.user, v)).toBe(false)
    expect(await recordCompletionIfDone(ctx.user, v)).toBe(false)
    const rows = await db.select().from(courseCompletions).where(eq(courseCompletions.templateId, v.templateId))
    expect(rows).toHaveLength(0)
  })

  it('тест сдан, шаги не отмечены — курс НЕ пройден', async () => {
    const v = await makeVersion('mixed-b', mixed())
    await db.insert(quizAttempts).values({ templateId: v.templateId, bid: 'q1', userId: ctx.user, selected: ['a'], correct: true })

    expect(await isCourseCompleted(ctx.user, v)).toBe(false)
  })

  it('и шаги, и тест — курс пройден, запись появляется один раз', async () => {
    const v = await makeVersion('mixed-c', mixed())
    await markAllSteps(v.versionId, v.templateId)
    await db.insert(quizAttempts).values({ templateId: v.templateId, bid: 'q1', userId: ctx.user, selected: ['a'], correct: true })

    expect(await recordCompletionIfDone(ctx.user, v)).toBe(true)
    expect(await recordCompletionIfDone(ctx.user, v)).toBe(true) // идемпотентность
    const rows = await db.select().from(courseCompletions).where(eq(courseCompletions.templateId, v.templateId))
    expect(rows).toHaveLength(1)
  })

  it('неверная попытка не засчитывается', async () => {
    const v = await makeVersion('mixed-d', mixed())
    await markAllSteps(v.versionId, v.templateId)
    await db.insert(quizAttempts).values({ templateId: v.templateId, bid: 'q1', userId: ctx.user, selected: ['b'], correct: false })

    expect(await isCourseCompleted(ctx.user, v)).toBe(false)
  })
})

describe('прогоны не складываются', () => {
  it('два неполных прогона одной версии не дают прохождения', async () => {
    const v = await makeVersion('two-runs', [{ type: 'step' }, { type: 'step' }])
    const rows = await db.select({ id: steps.id }).from(steps).where(eq(steps.versionId, v.versionId))
    // Первый прогон: отмечен только первый шаг. Второй прогон: только второй.
    for (const [i, s] of rows.entries()) {
      const [r] = await db.insert(runs).values({ templateId: v.templateId, versionId: v.versionId, version: 1, userId: ctx.user }).returning({ id: runs.id })
      await db.insert(runStepState).values({ runId: r.id, stepId: s.id, status: 'done' })
      void i
    }
    expect(await isCourseCompleted(ctx.user, v)).toBe(false)
  })

  it('повторная отметка того же шага в другом прогоне не засчитывается дважды', async () => {
    const v = await makeVersion('same-step-twice', [{ type: 'step' }, { type: 'step' }])
    const [first] = await db.select({ id: steps.id }).from(steps).where(eq(steps.versionId, v.versionId))
    for (let i = 0; i < 2; i++) {
      const [r] = await db.insert(runs).values({ templateId: v.templateId, versionId: v.versionId, version: 1, userId: ctx.user }).returning({ id: runs.id })
      await db.insert(runStepState).values({ runId: r.id, stepId: first.id, status: 'done' })
    }
    expect(await isCourseCompleted(ctx.user, v)).toBe(false)
  })
})

describe('однородные версии', () => {
  it('только шаги — достаточно отметить их', async () => {
    const v = await makeVersion('steps-only', [{ type: 'step' }, { type: 'step' }])
    await markAllSteps(v.versionId, v.templateId)
    expect(await isCourseCompleted(ctx.user, v)).toBe(true)
  })

  it('только тесты — достаточно сдать их', async () => {
    const v = await makeVersion('quiz-only', [{ type: 'quiz', content: { bid: 'q1' } }])
    await db.insert(quizAttempts).values({ templateId: v.templateId, bid: 'q1', userId: ctx.user, selected: ['a'], correct: true })
    expect(await isCourseCompleted(ctx.user, v)).toBe(true)
  })

  it('пустая версия прохождением не считается', async () => {
    const v = await makeVersion('empty', [{ type: 'text', content: { md: 'note' } }])
    expect(await isCourseCompleted(ctx.user, v)).toBe(false)
  })
})
