import { and, eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ЗАДАЧИ ЧЕРЕЗ MCP НА НАСТОЯЩЕЙ БАЗЕ.
 *
 * Юнит-тест рядом (issues-tools.test.ts) держит ворота на подменах; здесь проверяется то,
 * чего подмены показать не могут:
 *
 *  • СЧЁТЧИК ЧАСТОТЫ У ФОРМЫ И У АГЕНТА ОДИН. Не «оба что-то считают», а именно один:
 *    двадцать задач, заведённых как с сайта, исчерпывают порог и для инструмента MCP.
 *    Своя копия лимита у агента дала бы ему свои двадцать сверху — и счётчик, заведённый
 *    против скрипта в цикле (#869), не значил бы ничего ровно там, где пишет программа.
 *  • круг «завёл → прочитал с лентой → ответил → закрыл»: агент работает по номеру, и
 *    номер обязан приезжать обратно тем же.
 */
const { db, users, templates, issues, issueEvents, issueComments } = await import('@/shared/db')
const { mcpAddIssueComment, mcpCloseIssue, mcpCreateIssue, mcpGetIssue, mcpSearchIssues } = await import('@/features/mcp/tools')
const { openIssue } = await import('@/features/issues/core')
const { ISSUE_LIMITS } = await import('@/features/issues/limits')

const OWNER = 'mi-owner'
const LIST = `${OWNER}/mcp-issues`
let ownerId = ''
let strangerId = ''
let templateId = ''

/** Свежий список на каждый сюжет: ключи частоты считаются по паре человек+список. */
async function makeList(slug: string): Promise<string> {
  const [t] = await db
    .insert(templates)
    .values({ ownerId, slug, title: { en: slug }, currentVersion: 1 })
    .returning({ id: templates.id })
  return t.id
}

beforeAll(async () => {
  await resetTables([templates, users])
  const rows = await db
    .insert(users)
    .values([{ handle: OWNER }, { handle: 'mi-stranger' }])
    .returning({ id: users.id, handle: users.handle })
  ownerId = rows.find((r) => r.handle === OWNER)!.id
  strangerId = rows.find((r) => r.handle === 'mi-stranger')!.id
})

beforeEach(async () => {
  await db.delete(issues)
  await db.delete(templates)
  templateId = await makeList('mcp-issues')
})

describe('круг работы агента с задачей', () => {
  it('заводит, читает с лентой, отвечает и закрывает — всё по одному номеру', async () => {
    const made = await mcpCreateIssue(strangerId, {
      list: LIST,
      title: 'Шаг 3 не выполняется',
      body: 'На мобильном кнопка уезжает за край.',
    })
    expect('number' in made && made.number, 'номер задачи — то, чем агент её зовёт').toBe(1)
    expect('url' in made && made.url).toContain('/mcp-issues/issues/1')

    const replied = await mcpAddIssueComment(ownerId, { list: LIST, number: 1, body: 'Вижу, чиню.' })
    expect('error' in replied, JSON.stringify(replied)).toBe(false)

    const closed = await mcpCloseIssue(ownerId, { list: LIST, number: 1, stateReason: 'completed' })
    expect(closed).toMatchObject({ state: 'closed', stateReason: 'completed' })

    const read = await mcpGetIssue(strangerId, { list: LIST, number: 1 })
    expect(read).toMatchObject({ state: 'closed', title: 'Шаг 3 не выполняется' })
    // Лента — реплики И события вперемешку, по времени: иначе «закрыл» встанет хвостом
    // и агент прочитает разговор не в том порядке, в каком он шёл.
    const thread = ('thread' in read ? read.thread : []) ?? []
    expect(thread.map((p) => p.kind)).toEqual(['comment', 'event'])
    expect(thread[1]).toMatchObject({ kind: 'event', event: 'closed', closeReason: 'completed' })

    const found = await mcpSearchIssues(strangerId, { list: LIST, q: 'кнопка уезжает', state: 'closed' })
    // Слова из ТЕЛА задачи — поиск ищет там же, где на сайте.
    expect('results' in found && (found.results ?? []).map((r) => r.number)).toEqual([1])
  })

  it('закрытие дубликатом требует существующий номер — иначе отказ и ни следа', async () => {
    await mcpCreateIssue(strangerId, { list: LIST, title: 'Первая' })
    const res = await mcpCloseIssue(strangerId, { list: LIST, number: 1, stateReason: 'duplicate', duplicateOf: 42 })
    expect('error' in res && res.error).toMatch(/no issue with that number/i)

    const [row] = await db.select({ status: issues.status }).from(issues).where(eq(issues.templateId, templateId))
    expect(row.status, 'задача осталась открытой').toBe('open')
    expect(await db.select().from(issueEvents), 'и в ленте пусто').toEqual([])
  })
})

describe('счётчик частоты у сайта и у агента ОДИН', () => {
  it('⚠️ порог, выбранный формой, закрыт и для MCP', async () => {
    const listId = await makeList('rate-list')
    const ref = `${OWNER}/rate-list`
    // Свой человек на этот сюжет: счётчик задач считается по ПАРЕ человек+список, и
    // личный ключ переживает смену списка — задачи, заведённые соседними сюжетами,
    // съели бы часть порога (что само по себе и есть доказательство общего счётчика).
    const [writer] = await db.insert(users).values({ handle: 'mi-rate' }).returning({ id: users.id })

    // Заводим задачи ТЕМ ЖЕ путём, которым их заводит форма на сайте (её действие —
    // тонкая обёртка вокруг этой функции), пока порог не выбран целиком.
    for (let i = 0; i < ISSUE_LIMITS.issuePerUser; i++) {
      const r = await openIssue(writer.id, OWNER, 'rate-list', { title: `задача ${i + 1}` })
      expect(r.ok, `задача ${i + 1} из порога должна пройти`).toBe(true)
    }

    const overflow = await mcpCreateIssue(writer.id, { list: ref, title: 'двадцать первая, уже через агента' })
    expect('error' in overflow && overflow.error, 'у агента не должно быть своих двадцати').toMatch(/rate limit/i)

    const left = await db.select().from(issues).where(eq(issues.templateId, listId))
    expect(left.length, 'сверх порога не записано ничего').toBe(ISSUE_LIMITS.issuePerUser)
  }, 120_000)

  it('счётчик реплик — свой поток: исчерпанные задачи не мешают отвечать', async () => {
    const created = await mcpCreateIssue(ownerId, { list: LIST, title: 'разговор' })
    expect('number' in created).toBe(true)
    const said = await mcpAddIssueComment(ownerId, { list: LIST, number: 1, body: 'реплика' })
    expect('error' in said, JSON.stringify(said)).toBe(false)
    const [cmt] = await db
      .select({ body: issueComments.body })
      .from(issueComments)
      .where(and(eq(issueComments.issueId, (await db.select({ id: issues.id }).from(issues).limit(1))[0].id)))
    expect(cmt.body).toBe('реплика')
  })
})
