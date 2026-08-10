import { sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// Отчёт внешней проверки — наша сторона интеграций: прогонов чужого кода у нас нет,
// итог присылает агент снаружи. Проверяем на реальной БД то, из-за чего проверки
// перестали бы что-то значить: кто вправе отчитываться, что повторный отчёт
// ОБНОВЛЯЕТ прежний, и что в href предложения не уедет javascript:-ссылка.
const { db, suggestionReportedChecks, suggestions, templates, users } = await import('@/shared/db')
const { mcpReportCheck } = await import('@/features/mcp/tools')
const { reportedChecks } = await import('@/features/library/suggestion-checks')

let ownerId = ''
let authorId = ''
let strangerId = ''
let templateId = ''
let suggestionId = ''

beforeAll(async () => {
  await resetTables(sql`${templates}, ${users}`)
  const rows = await db
    .insert(users)
    .values([{ handle: 'chk-owner' }, { handle: 'chk-author' }, { handle: 'chk-stranger' }])
    .returning({ id: users.id, handle: users.handle })
  ownerId = rows.find((r) => r.handle === 'chk-owner')!.id
  authorId = rows.find((r) => r.handle === 'chk-author')!.id
  strangerId = rows.find((r) => r.handle === 'chk-stranger')!.id
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId, slug: 'checked-list', title: { en: 'Checked list' } })
    .returning({ id: templates.id })
  templateId = tpl.id
})

beforeEach(async () => {
  await db.delete(suggestions)
  const [sug] = await db
    .insert(suggestions)
    .values({ templateId, authorId, note: 'правка', baseVersion: 1, items: [], number: 7 })
    .returning({ id: suggestions.id })
  suggestionId = sug.id
})

const ok = { list: 'chk-owner/checked-list', number: 7, name: 'tests', status: 'ok' as const }

describe('report_check: кто вправе отчитаться', () => {
  it('владелец списка — да', async () => {
    expect(await mcpReportCheck(ownerId, ok)).toMatchObject({ reported: 'tests', status: 'ok' })
  })

  it('автор предложения — нет: иначе он красил бы собственные гейты зелёным', async () => {
    expect(await mcpReportCheck(authorId, ok)).toMatchObject({ error: expect.stringContaining('owner or a collaborator') })
    expect(await reportedChecks(suggestionId)).toHaveLength(0)
  })

  it('посторонний — нет', async () => {
    expect(await mcpReportCheck(strangerId, ok)).toMatchObject({ error: expect.stringContaining('owner or a collaborator') })
  })
})

describe('report_check: содержимое отчёта', () => {
  it('повторный отчёт той же проверки ОБНОВЛЯЕТ, а не плодит вторую строку', async () => {
    await mcpReportCheck(ownerId, { ...ok, status: 'pending', summary: 'запущено' })
    await mcpReportCheck(ownerId, { ...ok, status: 'fail', summary: '3 из 120 упали' })
    const all = await reportedChecks(suggestionId)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ title: 'tests', status: 'fail', detail: '3 из 120 упали', reportedBy: 'chk-owner' })
  })

  it('разные имена — разные проверки', async () => {
    await mcpReportCheck(ownerId, ok)
    await mcpReportCheck(ownerId, { ...ok, name: 'lint', status: 'warn' })
    expect(await reportedChecks(suggestionId)).toHaveLength(2)
  })

  it('неизвестный статус отклоняется, а не превращается в neutral', async () => {
    expect(await mcpReportCheck(ownerId, { ...ok, status: 'green' })).toMatchObject({ error: expect.stringContaining('status must be one of') })
    expect(await reportedChecks(suggestionId)).toHaveLength(0)
  })

  it('не-http ссылка отклоняется: она попадёт в href на странице предложения', async () => {
    expect(await mcpReportCheck(ownerId, { ...ok, url: 'javascript:alert(1)' })).toMatchObject({ error: expect.stringContaining('http') })
    expect(await reportedChecks(suggestionId)).toHaveLength(0)
  })

  it('пустое имя отклоняется — безымянную проверку не с чем сопоставить', async () => {
    expect(await mcpReportCheck(ownerId, { ...ok, name: '   ' })).toMatchObject({ error: expect.stringContaining('name') })
  })
})

describe('report_check: к какому предложению', () => {
  it('несуществующий номер — отказ', async () => {
    expect(await mcpReportCheck(ownerId, { ...ok, number: 999 })).toMatchObject({ error: 'suggestion not found' })
  })

  it('закрытое предложение отчёта не принимает: решение уже принято', async () => {
    await db.update(suggestions).set({ status: 'accepted' })
    expect(await mcpReportCheck(ownerId, ok)).toMatchObject({ error: 'suggestion is closed' })
  })

  it('чужой список — отказ по правам, а не «не найдено»', async () => {
    expect(await mcpReportCheck(strangerId, ok)).toMatchObject({ error: expect.stringContaining('owner or a collaborator') })
  })
})
