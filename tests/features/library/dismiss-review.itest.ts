import { eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Снятие чужого вердикта — как Dismiss review у GitHub.
 *
 * Смысл проверок: «просит доработать» блокирует принятие бессрочно, поэтому снятие
 * обязано (1) реально снимать блокировку, (2) быть доступно только тем, чей голос
 * вообще способен блокировать, (3) оставлять след — иначе это тихий обход ревью, и
 * (4) отменяться новым вердиктом того же рецензента: иначе переголосовавший остался
 * бы снятым, а его голос молча не считался.
 */
const session = vi.hoisted(() => ({ userId: '', handle: '' }))
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => ({ userId: session.userId, handle: session.handle }),
  getSession: async () => ({ userId: session.userId, handle: session.handle }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const { collaborators, db, suggestions, templates, users } = await import('@/shared/db')
const { dismissSuggestionReview, submitSuggestionReview } = await import('@/features/library/review-actions')
// Чтение переехало в review-queries (файл без 'use server') — см. линза 02, F2.
const { countApprovals, getSuggestionReviews, hasBlockingReview } = await import('@/features/library/review-queries')

let ownerId = ''
let reviewerId = ''
let strangerId = ''
let templateId = ''
let suggestionId = ''

const asOwner = () => Object.assign(session, { userId: ownerId, handle: 'dis-owner' })
const asReviewer = () => Object.assign(session, { userId: reviewerId, handle: 'dis-reviewer' })
const asStranger = () => Object.assign(session, { userId: strangerId, handle: 'dis-stranger' })

beforeAll(async () => {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
  const rows = await db
    .insert(users)
    .values([{ handle: 'dis-owner' }, { handle: 'dis-reviewer' }, { handle: 'dis-stranger' }, { handle: 'dis-author' }])
    .returning({ id: users.id, handle: users.handle })
  const byHandle = (h: string) => rows.find((r) => r.handle === h)!.id
  ownerId = byHandle('dis-owner')
  reviewerId = byHandle('dis-reviewer')
  strangerId = byHandle('dis-stranger')
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId, slug: 'dis-list', title: { en: 'List' } })
    .returning({ id: templates.id })
  templateId = tpl.id
  // Рецензент — КОЛЛАБОРАТОР: блокировать способен только голос владельца или
  // коллаборатора, а снимать чужой вердикт мы проверяем от имени владельца.
  await db.insert(collaborators).values({ templateId, userId: reviewerId })
})

beforeEach(async () => {
  await db.delete(suggestions)
  const [sug] = await db
    .insert(suggestions)
    .values({ templateId, authorId: strangerId, note: 'правка', baseVersion: 1, items: [], number: 1 })
    .returning({ id: suggestions.id })
  suggestionId = sug.id
  // Блокирующий вердикт от КОЛЛАБОРАТОРА — его и будет снимать владелец.
  asReviewer()
  await submitSuggestionReview(suggestionId, 'changes', 'так не пойдёт')
})

describe('снятие вердикта убирает блокировку', () => {
  it('до снятия принятие заблокировано, после — нет', async () => {
    expect(await hasBlockingReview(suggestionId)).toBe(true)
    asOwner()
    expect(await dismissSuggestionReview(suggestionId, 'dis-reviewer', 'рецензент ушёл, вопрос решён иначе')).toEqual({ ok: true })
    expect(await hasBlockingReview(suggestionId)).toBe(false)
  })

  it('вердикт остаётся в истории со следом: кто снял и почему', async () => {
    asOwner()
    await dismissSuggestionReview(suggestionId, 'dis-reviewer', 'вопрос решён в обсуждении')
    const [r] = await getSuggestionReviews(suggestionId, ownerId)
    expect(r.verdict).toBe('changes') // не удалён
    expect(r.blocking).toBe(false)
    expect(r.dismissed).toMatchObject({ by: 'dis-owner', reason: 'вопрос решён в обсуждении' })
  })
})

describe('кто вправе снимать', () => {
  it('посторонний — нет, иначе любой снимал бы чужие стоп-краны', async () => {
    asStranger()
    expect(await dismissSuggestionReview(suggestionId, 'dis-reviewer', 'мешает')).toEqual({ ok: false })
    expect(await hasBlockingReview(suggestionId)).toBe(true)
  })

  it('своё ревью так не снимают — для этого «убрать ревью»', async () => {
    asReviewer()
    expect(await dismissSuggestionReview(suggestionId, 'dis-reviewer', 'передумал')).toEqual({ ok: false })
  })

  it('без причины — отказ: снятие без объяснения это тихий обход ревью', async () => {
    asOwner()
    expect(await dismissSuggestionReview(suggestionId, 'dis-reviewer', '   ')).toEqual({ ok: false })
    expect(await hasBlockingReview(suggestionId)).toBe(true)
  })

  it('несуществующий рецензент — отказ', async () => {
    asOwner()
    expect(await dismissSuggestionReview(suggestionId, 'no-such-user', 'причина')).toEqual({ ok: false })
  })

  it('закрытое предложение не ревьюят и вердикты в нём не снимают', async () => {
    await db.update(suggestions).set({ status: 'accepted' }).where(eq(suggestions.id, suggestionId))
    asOwner()
    expect(await dismissSuggestionReview(suggestionId, 'dis-reviewer', 'причина')).toEqual({ ok: false })
  })
})

describe('после снятия', () => {
  it('новый вердикт того же рецензента снимает снятие', async () => {
    asOwner()
    await dismissSuggestionReview(suggestionId, 'dis-reviewer', 'решено иначе')
    asReviewer()
    await submitSuggestionReview(suggestionId, 'changes', 'нет, всё ещё не так')
    const [r] = await getSuggestionReviews(suggestionId, reviewerId)
    expect(r.dismissed).toBeNull()
    expect(r.isMine).toBe(true)
  })

  it('повторное снятие уже снятого ничего не ломает', async () => {
    asOwner()
    await dismissSuggestionReview(suggestionId, 'dis-reviewer', 'первая причина')
    expect(await dismissSuggestionReview(suggestionId, 'dis-reviewer', 'вторая причина')).toEqual({ ok: true })
    const [r] = await getSuggestionReviews(suggestionId, ownerId)
    expect(r.dismissed?.reason).toBe('вторая причина')
  })
})

describe('снятое одобрение не считается голосом', () => {
  it('гейт требуемых одобрений перестаёт быть закрытым после снятия', async () => {
    // Коллаборатор ОДОБРИЛ, владелец снял вердикт — счётчик одобрений обязан упасть.
    // Иначе снятие выглядит сделанным, а слияние по-прежнему считает зачёркнутый голос.
    asReviewer()
    await submitSuggestionReview(suggestionId, 'approve', 'ок')
    expect(await countApprovals(suggestionId)).toBe(1)
    asOwner()
    expect(await dismissSuggestionReview(suggestionId, 'dis-reviewer', 'одобрение выдано по ошибке')).toEqual({ ok: true })
    expect(await countApprovals(suggestionId)).toBe(0)
  })
})
