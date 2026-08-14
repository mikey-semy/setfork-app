import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// ПОЛКА ПРИ СОЗДАНИИ ЧЕРЕЗ MCP. У владельца списки родятся именно здесь, а не в форме сайта:
// без этого пути подсказка полки в вебе библиотеку не удержит, и разбор корпуса снова станет
// разовой уборкой. Опасность у параметра одна — имя приходит от ассистента, то есть снаружи.
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const { db, repositories, templates, users } = await import('@/shared/db')
const { mcpBulkCreate, mcpCreateList } = await import('@/features/mcp/tools')

let meId = ''
let otherId = ''

const items = [{ title: 'шаг' }]
// Слаг берём ИЗ ОТВЕТА, а не угадываем: он собирается транслитерацией, и выдуманное
// в тесте имя проверяло бы мою догадку про транслит, а не поведение инструмента.
const rowOf = async (res: unknown) => {
  const ref = String((res as { ref?: string }).ref ?? '')
  return (await db.select().from(templates).where(eq(templates.slug, ref.split('/')[1] ?? '')))[0]
}

beforeEach(async () => {
  await resetTables([templates, repositories, users])
  const [m] = await db.insert(users).values({ handle: 'cat-me' }).returning({ id: users.id })
  const [o] = await db.insert(users).values({ handle: 'cat-other' }).returning({ id: users.id })
  meId = m.id
  otherId = o.id
})
afterAll(async () => {
  await resetTables([templates, repositories, users])
})

describe('создание через MCP кладёт список на полку', () => {
  it('своя полка принимает список', async () => {
    const [cat] = await db.insert(repositories).values({ ownerId: meId, name: 'skills', title: { ru: 'Скиллы' } }).returning({ id: repositories.id })

    const res = await mcpCreateList(meId, { title: 'Мой навык', items, catalog: 'skills' })

    expect(res).toMatchObject({ catalog: 'skills' })
    expect((await rowOf(res)).repositoryId).toBe(cat.id)
  })

  it('чужая полка не принимает: имя ищется среди СВОИХ', async () => {
    await db.insert(repositories).values({ ownerId: otherId, name: 'secret', title: { ru: 'secret' } })

    const res = await mcpCreateList(meId, { title: 'Чужая полка', items, catalog: 'secret' })

    // Список создан, но лежит без полки — и ответ об этом говорит, а не молчит.
    expect('catalog' in res && String(res.catalog)).toContain('not found')
    expect((await rowOf(res)).repositoryId).toBeNull()
  })

  it('несуществующее имя не роняет создание', async () => {
    // Список уже написан; полка тут не главное, и отказывать из-за неё нельзя.
    const res = await mcpCreateList(meId, { title: 'Без полки', items, catalog: 'нет-такой' })

    expect(res).toMatchObject({ status: 'draft' })
    expect((await rowOf(res)).repositoryId).toBeNull()
  })

  it('пачка называет исход по полке — и в плане, и после записи', async () => {
    // Опечатка в имени иначе всплыла бы только после записи, причём сразу на всей сотне:
    // «создано 100» читается как успех, а списки лежат мимо полок.
    await db.insert(repositories).values({ ownerId: meId, name: 'skills', title: { ru: 'Скиллы' } })
    const batch = [
      { title: 'Первый навык', items, catalog: 'skills' },
      { title: 'Второй навык', items, catalog: 'sklls' },
    ]

    const plan = await mcpBulkCreate(meId, batch)
    const done = await mcpBulkCreate(meId, batch, false)

    expect('lists' in plan && plan.lists.map((l) => l.catalog)).toEqual(['skills', 'not found among your catalogs: sklls'])
    expect('lists' in done && done.lists.map((l) => l.catalog)).toEqual(['skills', 'not found among your catalogs: sklls'])
  })

  it('без параметра всё как было', async () => {
    const res = await mcpCreateList(meId, { title: 'Обычный список', items })

    expect('catalog' in res && res.catalog).toBeUndefined()
    expect((await rowOf(res)).repositoryId).toBeNull()
  })
})
