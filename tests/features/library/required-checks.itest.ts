import { eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * Внешние проверки как гейт слияния — наш аналог required status checks.
 *
 * Проверяем ровно то, из-за чего гейт был бы бесполезен или вреден:
 *  - выключён по умолчанию (иначе первый же чужой отчёт запирает список);
 *  - включённый держит слияние на упавшей проверке И на незавершённой («ещё не
 *    прошла» — это не «прошла», иначе гейт обходится гонкой);
 *  - работает на ОБОИХ путях слияния: правило одно, а не «у веток есть, у пунктов
 *    нет»;
 *  - отчёт «ок» открывает дорогу без ручного вмешательства.
 */
const { db, suggestions, templates, users } = await import('@/shared/db')
const { createSuggestion, mergeSuggestion } = await import('@/features/library/suggestion-core')
const { mcpReportCheck } = await import('@/features/mcp/tools')
const { emptyBlock, toProposedItems } = await import('@/features/library/editor')

let ownerId = ''
let templateId = ''
let authorSeq = 0

const items = () => toProposedItems([{ ...emptyBlock('step'), title: 'Шаг' }], 'en')

/** Второе предложение того же списка — чтобы номера не пересекались. */
async function newSuggestion2(): Promise<string> {
  const [author] = await db.insert(users).values({ handle: `chk-author-${++authorSeq}` }).returning({ id: users.id })
  const created = await createSuggestion(author.id, templateId, { note: 'вторая', items: items() })
  if (!created.ok) throw new Error(created.reason)
  return created.id
}

const items2 = () => toProposedItems([{ ...emptyBlock('step'), title: 'Шаг ДРУГОЙ' }], 'en')

async function newSuggestion(): Promise<string> {
  const [author] = await db.insert(users).values({ handle: `chk-author-${++authorSeq}` }).returning({ id: users.id })
  const created = await createSuggestion(author.id, templateId, { note: 'правка', items: items() })
  if (!created.ok) throw new Error(created.reason)
  return created.id
}

const setChecksGate = (on: boolean) =>
  db.update(templates).set({ prSettings: { blockOnFailedChecks: on } }).where(eq(templates.id, templateId))

const report = (status: string) => mcpReportCheck(ownerId, { list: 'gate-owner/gate-list', number: 1, name: 'tests', status })

beforeAll(async () => {
  await resetTables([templates, users])
  const [owner] = await db.insert(users).values({ handle: 'gate-owner' }).returning({ id: users.id })
  ownerId = owner.id
})

beforeEach(async () => {
  await resetTables([templates])
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId, slug: 'gate-list', title: { en: 'Gate list' }, visibility: 'public', status: 'published' })
    .returning({ id: templates.id })
  templateId = tpl.id
})

describe('гейт выключен по умолчанию', () => {
  it('упавшая проверка слиянию не мешает, пока настройку не включили', async () => {
    const id = await newSuggestion()
    await report('fail')
    expect(await mergeSuggestion(id, ownerId)).toMatchObject({ ok: true })
  })
})

describe('гейт включён', () => {
  beforeEach(async () => {
    await setChecksGate(true)
  })

  it('упавшая проверка держит слияние и называет себя', async () => {
    const id = await newSuggestion()
    await report('fail')
    expect(await mergeSuggestion(id, ownerId)).toMatchObject({ ok: false, reason: 'checks failed: tests' })
  })

  it('незавершённая проверка держит так же: «ещё не прошла» — это не «прошла»', async () => {
    const id = await newSuggestion()
    await report('pending')
    expect(await mergeSuggestion(id, ownerId)).toMatchObject({ ok: false, reason: 'checks still running: tests' })
  })

  it('после отчёта «ок» слияние проходит — без ручного вмешательства', async () => {
    const id = await newSuggestion()
    await report('fail')
    expect(await mergeSuggestion(id, ownerId)).toMatchObject({ ok: false })
    await report('ok')
    expect(await mergeSuggestion(id, ownerId)).toMatchObject({ ok: true })
  })

  it('проверок нет вовсе — гейт не выдумывает несуществующее препятствие', async () => {
    const id = await newSuggestion()
    expect(await mergeSuggestion(id, ownerId)).toMatchObject({ ok: true })
  })

  it('«предупреждение» и «нейтрально» слияние не держат: это не провал', async () => {
    const id = await newSuggestion()
    await report('warn')
    await mcpReportCheck(ownerId, { list: 'gate-owner/gate-list', number: 1, name: 'lint', status: 'neutral' })
    expect(await mergeSuggestion(id, ownerId)).toMatchObject({ ok: true })
  })

  it('зелёная проверка ПРОТУХАЕТ, когда предложение поменяли', async () => {
    const id = await newSuggestion()
    await report('ok')
    expect(await mergeSuggestion(id, ownerId)).toMatchObject({ ok: true })

    // Второе предложение: отчитались «ок», ПОТОМ поменяли содержимое.
    const id2 = await newSuggestion2()
    await mcpReportCheck(ownerId, { list: 'gate-owner/gate-list', number: 2, name: 'tests', status: 'ok' })
    await db.update(suggestions).set({ items: items2() }).where(eq(suggestions.id, id2))
    expect(await mergeSuggestion(id2, ownerId)).toMatchObject({ ok: false, reason: expect.stringContaining('older revision') })
  })

  it('упавшая проверка держит и путь «принять пункты» — правило одно на оба пути', async () => {
    const id = await newSuggestion()
    await report('fail')
    // Тот же вход, которым принимает страница и MCP (apply_suggestion).
    const { applySuggestion } = await import('@/features/library/suggestion-core')
    expect(await applySuggestion(id, ownerId)).toMatchObject({ ok: false, reason: 'checks failed: tests' })
    const [row] = await db.select({ status: suggestions.status }).from(suggestions).where(eq(suggestions.id, id))
    expect(row.status).toBe('open') // не проскочило мимо гейта
  })
})
