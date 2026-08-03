import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { courseCompletions, db, quizAttempts, steps, templates, templateVersions, users } from '@/shared/db'
import { isCourseCompleted, recordCompletionIfDone } from '@/shared/completion'
import { quizContentHash } from '@/core/domain/quiz-fingerprint'

/**
 * Сертификат — документ о ПРОШЛОМ. Три способа, которыми он врал:
 *
 * 1. Название курса, автор и имя учащегося брались в момент открытия страницы, поэтому
 *    переименование курса, смена имени в профиле или передача владения меняли уже
 *    выданный документ.
 * 2. Ответ на тест засчитывался по стабильному bid, а bid переживает правку вопроса:
 *    автор менял сам вопрос, и старое «верно» продолжало работать.
 * 3. Прохождение удалялось вместе с курсом и пропадало при закрытии доступа — то есть
 *    достижение исчезало у того, кто его заработал.
 */
const OWNER = 'cs-owner'
const LEARNER = 'cs-learner'
const ctx: Record<string, string> = {}

async function makeCourse(slug: string, quiz: Record<string, unknown>) {
  const [t] = await db
    .insert(templates)
    .values({ ownerId: ctx.owner, slug, title: { en: 'Original title' }, currentVersion: 1 })
    .returning({ id: templates.id })
  const [v] = await db
    .insert(templateVersions)
    .values({ templateId: t.id, version: 1, note: 'v1' })
    .returning({ id: templateVersions.id })
  await db.insert(steps).values({ versionId: v.id, n: 1, type: 'quiz', content: quiz, title: { en: 'Q' } })
  return { templateId: t.id, versionId: v.id, version: 1 }
}

const QUIZ = { bid: 'q1', kind: 'choice', question: 'Capital of France?', options: [{ id: 'a', text: 'Paris', correct: true }, { id: 'b', text: 'Rome' }] }

beforeEach(async () => {
  for (const h of [OWNER, LEARNER]) await db.delete(users).where(eq(users.handle, h))
  const [o] = await db.insert(users).values({ handle: OWNER, name: 'Original Author' }).returning({ id: users.id })
  const [l] = await db.insert(users).values({ handle: LEARNER, name: 'Original Learner' }).returning({ id: users.id })
  ctx.owner = o.id
  ctx.learner = l.id
})

describe('снимок фактов на момент выдачи', () => {
  it('переименование курса и смена имён не меняют уже выданный документ', async () => {
    const c = await makeCourse('course-a', QUIZ)
    await db.insert(quizAttempts).values({
      templateId: c.templateId,
      bid: 'q1',
      userId: ctx.learner,
      selected: ['a'],
      correct: true,
      contentHash: quizContentHash(QUIZ),
    })
    expect(await recordCompletionIfDone(ctx.learner, c)).toBe(true)

    // Всё, из чего документ раньше собирался на лету, меняем.
    await db.update(templates).set({ title: { en: 'Renamed course' } }).where(eq(templates.id, c.templateId))
    await db.update(users).set({ name: 'Renamed Author' }).where(eq(users.id, ctx.owner))
    await db.update(users).set({ name: 'Renamed Learner' }).where(eq(users.id, ctx.learner))

    const [row] = await db.select().from(courseCompletions).where(eq(courseCompletions.templateId, c.templateId))
    expect(row.courseTitle).toEqual({ en: 'Original title' })
    expect(row.issuerName).toBe('Original Author')
    expect(row.learnerName).toBe('Original Learner')
  })

  it('прохождение переживает удаление курса', async () => {
    const c = await makeCourse('course-b', QUIZ)
    await db.insert(quizAttempts).values({
      templateId: c.templateId,
      bid: 'q1',
      userId: ctx.learner,
      selected: ['a'],
      correct: true,
      contentHash: quizContentHash(QUIZ),
    })
    await recordCompletionIfDone(ctx.learner, c)

    await db.delete(templates).where(eq(templates.id, c.templateId))

    const rows = await db.select().from(courseCompletions).where(eq(courseCompletions.userId, ctx.learner))
    expect(rows).toHaveLength(1)
    expect(rows[0].templateId).toBeNull() // связь порвана
    expect(rows[0].courseTitle).toEqual({ en: 'Original title' }) // документ цел
  })
})

describe('ответ привязан к содержимому вопроса', () => {
  it('правка самого вопроса требует пересдачи', async () => {
    const c = await makeCourse('course-c', QUIZ)
    await db.insert(quizAttempts).values({
      templateId: c.templateId,
      bid: 'q1',
      userId: ctx.learner,
      selected: ['a'],
      correct: true,
      contentHash: quizContentHash(QUIZ),
    })
    expect(await isCourseCompleted(ctx.learner, c)).toBe(true)

    // Тот же блок (bid не менялся), но вопрос и верный ответ другие.
    const changed = { ...QUIZ, question: 'Capital of Italy?', options: [{ id: 'a', text: 'Paris' }, { id: 'b', text: 'Rome', correct: true }] }
    await db.update(steps).set({ content: changed }).where(eq(steps.versionId, c.versionId))

    expect(await isCourseCompleted(ctx.learner, c)).toBe(false)
  })

  it('правка оформления вокруг вопроса пересдачи не требует', async () => {
    const c = await makeCourse('course-d', QUIZ)
    await db.insert(quizAttempts).values({
      templateId: c.templateId,
      bid: 'q1',
      userId: ctx.learner,
      selected: ['a'],
      correct: true,
      contentHash: quizContentHash(QUIZ),
    })

    // Меняем только пояснение после сдачи — сама задача та же.
    await db.update(steps).set({ content: { ...QUIZ, explain: 'Paris has been the capital since 987.' } }).where(eq(steps.versionId, c.versionId))

    expect(await isCourseCompleted(ctx.learner, c)).toBe(true)
  })

  it('ответ без отпечатка (до появления поля) засчитывается как прежде', async () => {
    const c = await makeCourse('course-e', QUIZ)
    await db.insert(quizAttempts).values({ templateId: c.templateId, bid: 'q1', userId: ctx.learner, selected: ['a'], correct: true })
    expect(await isCourseCompleted(ctx.learner, c)).toBe(true)
  })
})
