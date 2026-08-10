import { eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * Предложить → отревьюить → слить через MCP.
 *
 * Смысл проверок один: агент проходит ЧЕРЕЗ те же ворота, что человек. Если гейт
 * работает на странице, но не работает у агента, то это не гейт, а украшение —
 * достаточно попросить ассистента, и правка уедет в чужой список мимо ревью.
 *
 * Поэтому ядра общие (suggestion-core), а здесь проверяется, что MCP действительно
 * зовёт их, а не свою копию условий.
 */
const { collaborators, db, suggestions, suggestionReviews, templates, users } = await import('@/shared/db')
const { mcpMergeSuggestion, mcpReviewSuggestion, mcpSuggestEdit } = await import('@/features/mcp/tools')

let ownerId = ''
let fanId = ''
let strangerId = ''
let templateId = ''
// Автор у каждого теста СВОЙ: кап «10 правок за 10 минут» — настоящий гейт, и один
// аккаунт упёрся бы в него к середине файла, молча перестав создавать предложения.
let fanSeq = 0

beforeAll(async () => {
  await resetTables(sql`${templates}, ${users}`)
  const rows = await db
    .insert(users)
    .values([{ handle: 'flow-owner' }, { handle: 'flow-stranger' }])
    .returning({ id: users.id, handle: users.handle })
  const byHandle = (h: string) => rows.find((r) => r.handle === h)!.id
  ownerId = byHandle('flow-owner')
  strangerId = byHandle('flow-stranger')
})

beforeEach(async () => {
  // truncate, а не delete: у списка есть зависимости, которые delete не уносит, и
  // остаток прошлого теста превращал следующий в загадку.
  await resetTables(sql`${templates}`, { restartIdentity: false })
  const [fan] = await db.insert(users).values({ handle: `flow-fan-${++fanSeq}` }).returning({ id: users.id })
  fanId = fan.id
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId, slug: 'flow-list', title: { en: 'Flow list' }, visibility: 'public', status: 'published' })
    .returning({ id: templates.id })
  templateId = tpl.id
})

const items = [{ type: 'step' as const, title: 'Поставить Docker', desc: 'версия 24 или новее' }]
const suggest = (userId: string) => mcpSuggestEdit(userId, { list: 'flow-owner/flow-list', note: 'добавил шаг', items })

describe('предложить правку', () => {
  it('посторонний предлагает — правка появляется и ЖДЁТ решения владельца', async () => {
    const res = await suggest(fanId)
    expect(res).toMatchObject({ number: 1 })
    const [row] = await db.select({ status: suggestions.status, authorId: suggestions.authorId }).from(suggestions)
    expect(row).toMatchObject({ status: 'open', authorId: fanId })
  })

  it('пустой список пунктов отклоняется — принимать было бы нечего', async () => {
    expect(await mcpSuggestEdit(fanId, { list: 'flow-owner/flow-list', note: 'пусто', items: [] })).toMatchObject({
      error: expect.stringContaining('items'),
    })
  })

  it('приватный чужой список — «не найден», а не «нельзя»: существование не подтверждаем', async () => {
    await db.update(templates).set({ visibility: 'private' }).where(eq(templates.id, templateId))
    expect(await suggest(strangerId)).toMatchObject({ error: 'list not found' })
  })

  it('настройка «только коллаборанты» держит и агента', async () => {
    await db.update(templates).set({ prSettings: { allowFrom: 'collaborators' } }).where(eq(templates.id, templateId))
    expect(await suggest(fanId)).toMatchObject({ error: expect.stringContaining('collaborators only') })
    await db.insert(collaborators).values({ templateId, userId: fanId })
    expect(await suggest(fanId)).toMatchObject({ number: 1 })
  })

  it('замороженный список правок не принимает', async () => {
    await db.update(templates).set({ frozenAt: new Date() }).where(eq(templates.id, templateId))
    expect(await suggest(fanId)).toMatchObject({ error: expect.stringContaining('frozen') })
  })
})

describe('отревьюить', () => {
  beforeEach(async () => {
    // Проверяем результат: молча не созданное предложение превращало бы все
    // проверки ниже в «не найдено» и выглядело бы как дефект инструмента.
    expect(await suggest(fanId)).toMatchObject({ number: 1 })
  })

  it('владелец просит доработать — вердикт сохранён', async () => {
    expect(await mcpReviewSuggestion(ownerId, { list: 'flow-owner/flow-list', number: 1, verdict: 'changes', body: 'уточните версию' })).toMatchObject({
      verdict: 'changes',
    })
    const [r] = await db.select({ verdict: suggestionReviews.verdict }).from(suggestionReviews)
    expect(r.verdict).toBe('changes')
  })

  it('автор своё же предложение не ревьюит', async () => {
    expect(await mcpReviewSuggestion(fanId, { list: 'flow-owner/flow-list', number: 1, verdict: 'approve' })).toMatchObject({
      error: expect.stringContaining('your own'),
    })
  })

  it('повторный вердикт ПЕРЕЗАПИСЫВАЕТ прежний, а не копится', async () => {
    await mcpReviewSuggestion(ownerId, { list: 'flow-owner/flow-list', number: 1, verdict: 'changes' })
    await mcpReviewSuggestion(ownerId, { list: 'flow-owner/flow-list', number: 1, verdict: 'approve' })
    const rows = await db.select({ verdict: suggestionReviews.verdict }).from(suggestionReviews)
    expect(rows).toHaveLength(1)
    expect(rows[0].verdict).toBe('approve')
  })

  it('несуществующий номер — отказ', async () => {
    expect(await mcpReviewSuggestion(ownerId, { list: 'flow-owner/flow-list', number: 99, verdict: 'approve' })).toMatchObject({
      error: 'suggestion not found',
    })
  })
})

describe('слить', () => {
  beforeEach(async () => {
    expect(await suggest(fanId)).toMatchObject({ number: 1 })
  })

  it('владелец сливает — правка принята, версия создана', async () => {
    const res = await mcpMergeSuggestion(ownerId, { list: 'flow-owner/flow-list', number: 1 })
    expect(res).toMatchObject({ merged: 1, kind: 'items' })
    const [row] = await db.select({ status: suggestions.status }).from(suggestions)
    expect(row.status).toBe('accepted')
  })

  it('посторонний не сливает чужое', async () => {
    expect(await mcpMergeSuggestion(strangerId, { list: 'flow-owner/flow-list', number: 1 })).toMatchObject({
      error: expect.stringContaining('not your list'),
    })
  })

  it('«просит доработать» держит слияние и через MCP — иначе гейт обходится ассистентом', async () => {
    await db.insert(collaborators).values({ templateId, userId: strangerId })
    await mcpReviewSuggestion(strangerId, { list: 'flow-owner/flow-list', number: 1, verdict: 'changes', body: 'нет' })
    expect(await mcpMergeSuggestion(ownerId, { list: 'flow-owner/flow-list', number: 1 })).toMatchObject({
      error: expect.stringContaining('requested changes'),
    })
  })

  it('требуемые одобрения держат слияние', async () => {
    await db.update(templates).set({ prSettings: { requiredApprovals: 1 } }).where(eq(templates.id, templateId))
    expect(await mcpMergeSuggestion(ownerId, { list: 'flow-owner/flow-list', number: 1 })).toMatchObject({
      error: expect.stringContaining('approval'),
    })
    await mcpReviewSuggestion(ownerId, { list: 'flow-owner/flow-list', number: 1, verdict: 'approve' })
    expect(await mcpMergeSuggestion(ownerId, { list: 'flow-owner/flow-list', number: 1 })).toMatchObject({ merged: 1 })
  })

  it('уже принятое второй раз не сливается', async () => {
    await mcpMergeSuggestion(ownerId, { list: 'flow-owner/flow-list', number: 1 })
    expect(await mcpMergeSuggestion(ownerId, { list: 'flow-owner/flow-list', number: 1 })).toMatchObject({
      error: expect.stringContaining('already accepted'),
    })
  })
})
