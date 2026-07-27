import { eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Массовое создание через MCP — ускоритель ПОД РУКОЙ человека. Опасность ровно в том, чем
// он полезен: одним вызовом можно налить сотню списков. Тесты держат три предохранителя:
// сухой прогон по умолчанию (ничего не пишет), дедуп по заголовку (повтор после обрыва не
// удваивает библиотеку) и черновик вместо публикации.
const { agentActions, db, suggestions, templates, users } = await import('@/shared/db')
const { MCP_BULK_MAX, mcpApplySuggestion, mcpBulkCreate, mcpPendingSuggestions } = await import('@/features/mcp/tools')

let ownerId = ''
let botId = ''

// Пункты выводим ИЗ ЗАГОЛОВКА: с общим набором шагов любые два списка стали бы почти-дублями
// (и правильно — содержимое одинаковое). Фикстура должна отличаться содержимым, как в жизни.
const list = (title: string) => ({ title, items: [{ title: `${title}: подготовка` }, { title: `${title}: основной шаг` }] })
const countMine = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(templates).where(eq(templates.ownerId, ownerId)))[0].n

beforeAll(async () => {
  await db.execute(sql`truncate table ${agentActions}, ${suggestions}, ${templates}, ${users} restart identity cascade`)
  const [o] = await db.insert(users).values({ handle: 'bulk-owner' }).returning({ id: users.id })
  const [b] = await db.insert(users).values({ handle: 'bulk-bot', accountType: 'agent' }).returning({ id: users.id })
  ownerId = o.id
  botId = b.id
})

beforeEach(async () => {
  await db.delete(templates)
  await db.delete(agentActions)
})

describe('сухой прогон по умолчанию', () => {
  it('без dryRun:false ничего не создаётся, но план виден', async () => {
    const res = await mcpBulkCreate(ownerId, [list('Хлеб на закваске'), list('Ремонт крана')])
    expect('error' in res).toBe(false)
    if ('error' in res) return
    expect(res).toMatchObject({ dryRun: true, planned: 2, created: 0 })
    expect(res.lists.every((l) => l.status === 'would-create')).toBe(true)
    expect(res.lists[0].slug).toBeTruthy() // слаг показан заранее — видно, каким будет адрес
    expect(await countMine()).toBe(0)
  })

  it('dryRun:false создаёт — черновиками', async () => {
    const res = await mcpBulkCreate(ownerId, [list('Хлеб на закваске'), list('Ремонт крана')], false)
    if ('error' in res) throw new Error(res.error)
    expect(res).toMatchObject({ dryRun: false, created: 2, duplicates: 0, failed: 0 })
    expect(await countMine()).toBe(2)
    const rows = await db.select({ status: templates.status, visibility: templates.visibility }).from(templates)
    expect(rows.every((r) => r.status === 'draft')).toBe(true)
  })
})

describe('дедуп: повтор после обрыва не удваивает библиотеку', () => {
  it('тот же заголовок вторым вызовом — duplicate, не второй список', async () => {
    await mcpBulkCreate(ownerId, [list('Хлеб на закваске')], false)
    const again = await mcpBulkCreate(ownerId, [list('  хлеб  НА  закваске  '), list('Новый список')], false)
    if ('error' in again) throw new Error(again.error)
    expect(again).toMatchObject({ duplicates: 1, created: 1 })
    expect(await countMine()).toBe(2)
  })

  it('дубли внутри ОДНОЙ пачки тоже ловятся', async () => {
    const res = await mcpBulkCreate(ownerId, [list('Одно и то же'), list('одно и то же')], false)
    if ('error' in res) throw new Error(res.error)
    expect(res).toMatchObject({ created: 1, duplicates: 1 })
  })

  it('дедуп работает и в сухом прогоне — план не врёт', async () => {
    const res = await mcpBulkCreate(ownerId, [list('Дубль'), list('дубль')])
    if ('error' in res) throw new Error(res.error)
    expect(res.duplicates).toBe(1)
  })
})

describe('почти-дубли в пачке', () => {
  const breadItems = ['Смешать муку воду соль дрожжи', 'Замесить тесто до гладкости', 'Дать подняться два часа', 'Сформовать буханку', 'Испечь при 240 градусах']
  const reworded = {
    title: 'Печём хлеб дома своими руками',
    tags: ['кулинария'],
    items: [
      { title: 'Смешайте муку с водой солью и дрожжами' },
      { title: 'Вымешивайте тесто пока не станет гладким' },
      { title: 'Оставьте подниматься на два часа' },
      { title: 'Сформуйте буханку' },
      { title: 'Выпекайте при 240 градусах' },
    ],
  }

  it('переписанный другими словами список — не создаётся (заголовок другой, содержимое то же)', async () => {
    const first = await mcpBulkCreate(ownerId, [{ title: 'Как испечь хлеб дома', tags: ['кулинария'], items: breadItems.map((t) => ({ title: t })) }], false)
    if ('error' in first) throw new Error(first.error)
    expect(first.created).toBe(1)

    const second = await mcpBulkCreate(ownerId, [reworded], false)
    if ('error' in second) throw new Error(second.error)
    expect(second).toMatchObject({ created: 0, duplicates: 1 })
    expect(second.lists[0].reason).toContain('почти дубль')
    expect(await countMine()).toBe(1)
  })

  it('сухой прогон тоже показывает почти-дубли: план обязан говорить правду', async () => {
    await mcpBulkCreate(ownerId, [{ title: 'Как испечь хлеб дома', tags: ['кулинария'], items: breadItems.map((t) => ({ title: t })) }], false)
    const plan = await mcpBulkCreate(ownerId, [reworded])
    if ('error' in plan) throw new Error(plan.error)
    expect(plan).toMatchObject({ dryRun: true, duplicates: 1 })
  })

  it('список на ту же тему, но другой — создаётся (не глушим нормальные варианты)', async () => {
    await mcpBulkCreate(ownerId, [{ title: 'Как испечь хлеб дома', tags: ['кулинария'], items: breadItems.map((t) => ({ title: t })) }], false)
    const other = await mcpBulkCreate(
      ownerId,
      [{ title: 'Хлеб на закваске без дрожжей', tags: ['кулинария'], items: ['Вывести закваску за пять дней', 'Освежить закваску утром', 'Складывать тесто каждый час', 'Холодная ферментация в холодильнике', 'Печь на камне с паром'].map((t) => ({ title: t })) }],
      false,
    )
    if ('error' in other) throw new Error(other.error)
    expect(other).toMatchObject({ created: 1, duplicates: 0 })
  })
})

describe('границы пачки', () => {
  it('пустой вход и записи без заголовка — ошибка, а не «создано 0»', async () => {
    expect(await mcpBulkCreate(ownerId, [], false)).toMatchObject({ error: expect.stringContaining('nothing to create') })
    expect(await mcpBulkCreate(ownerId, [{ title: '   ', items: [{ title: 'x' }] }], false)).toMatchObject({ error: expect.stringContaining('nothing to create') })
  })

  it('больше предела за раз — отказ целиком (не «сколько влезло»)', async () => {
    const many = Array.from({ length: MCP_BULK_MAX + 1 }, (_, i) => list(`Список ${i}`))
    expect(await mcpBulkCreate(ownerId, many, false)).toMatchObject({ error: expect.stringContaining('too many lists') })
    expect(await countMine()).toBe(0)
  })

  it('пачка попадает в журнал действий как сделанная ЧЕЛОВЕКОМ через ассистента', async () => {
    await mcpBulkCreate(ownerId, [list('Журнал')], false)
    const [row] = await db.select().from(agentActions)
    expect(row).toMatchObject({ loop: 'mcp', action: 'list.bulk', principalMode: 'on_behalf_of', resultStatus: 'ok' })
  })
})

describe('разбор правок из ассистента', () => {
  it('открытые правки на своих списках видно, чужие — нет', async () => {
    const [t] = await db.insert(templates).values({ ownerId, slug: 'mine', title: { ru: 'Моё' }, currentVersion: 1 }).returning({ id: templates.id })
    const [alien] = await db.insert(templates).values({ ownerId: botId, slug: 'alien', title: { ru: 'Чужое' }, currentVersion: 1 }).returning({ id: templates.id })
    await db.insert(suggestions).values({ templateId: t.id, authorId: botId, baseVersion: 1, note: 'правка', items: [{ title: { ru: 'Шаг' }, desc: {}, command: '', hasImage: false, level: 'required', why: {}, section: {}, subtasks: [], refs: [] }] })
    await db.insert(suggestions).values({ templateId: alien.id, authorId: ownerId, baseVersion: 1, note: 'чужая', items: [] })

    const res = await mcpPendingSuggestions(ownerId)
    expect(res.pending).toBe(1)
    expect(res.suggestions[0]).toMatchObject({ list: 'mine', author: 'bulk-bot', items: 1 })
  })

  // 20с: путь приёма тянет модуль серверных экшенов и делает реальную запись версии —
  // на раннере CI дефолтные 5с этого не покрывают (проверено: 5166мс).
  it('принять чужую правку нельзя, свою — можно, и создаётся версия', async () => {
    const [t] = await db.insert(templates).values({ ownerId, slug: 'mine2', title: { ru: 'Моё 2' }, currentVersion: 1 }).returning({ id: templates.id })
    const [sug] = await db
      .insert(suggestions)
      .values({ templateId: t.id, authorId: botId, baseVersion: 1, note: 'улучшение', items: [{ title: { ru: 'Новый шаг' }, desc: {}, command: '', hasImage: false, level: 'required', why: {}, section: {}, subtasks: [], refs: [] }] })
      .returning({ id: suggestions.id })

    expect(await mcpApplySuggestion(botId, sug.id)).toMatchObject({ error: 'not your list' })
    expect(await mcpApplySuggestion(ownerId, sug.id)).toMatchObject({ version: 2 })
    // Повторный приём — уже принято, а не «ещё одна версия».
    expect(await mcpApplySuggestion(ownerId, sug.id)).toMatchObject({ error: 'already accepted' })
  }, 20_000)
})
