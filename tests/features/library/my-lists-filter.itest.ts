import { beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ПОИСК И ФИЛЬТРЫ «МОИХ СПИСКОВ» — ТА ЖЕ ВЫБОРКА, ЧТО НА ВКЛАДКЕ ПРОФИЛЯ.
 *
 * Владелец 02.09.2026: «списки из sidebar — как отдельная страница до сих пор без поиска
 * и фильтров». Своя выборка означала бы два разных ответа на один вопрос: у профиля поиск
 * идёт по названию и адресу, а черновик отличается от приватного по состоянию, а не по
 * полю visibility.
 *
 * ⚠️ Отдельно проверяется, что отбор сохранённым запросом (`?sq=`) СОСТАВЛЯЕТСЯ с поиском,
 * а не подменяется им: при переходе на общую выборку он мог тихо перестать работать —
 * набор просто не сузился бы, и человек увидел бы всю библиотеку.
 */
const { db, templates, users } = await import('@/shared/db')
const { getProfileListPage } = await import('@/features/library/queries/profile-lists')

let ownerId = ''
const idBySlug = new Map<string, string>()

beforeEach(async () => {
  await resetTables([templates, users])
  const [u] = await db.insert(users).values({ handle: 'lib-owner' }).returning({ id: users.id })
  ownerId = u.id
  const rows = await db
    .insert(templates)
    .values([
      { ownerId, slug: 'redis-cheatsheet', title: { ru: 'Шпаргалка по Redis' }, status: 'published' as const, visibility: 'public' as const },
      { ownerId, slug: 'private-notes', title: { ru: 'Личные заметки' }, status: 'published' as const, visibility: 'private' as const },
      { ownerId, slug: 'redis-draft', title: { ru: 'Redis: черновик' }, status: 'draft' as const, visibility: 'public' as const },
      { ownerId, slug: 'forked-one', title: { ru: 'Форк чужого' }, status: 'published' as const, visibility: 'public' as const, origin: 'forked' as const },
    ])
    .returning({ id: templates.id, slug: templates.slug })
  for (const r of rows) idBySlug.set(r.slug, r.id)
})

const page = async (f: Record<string, unknown> = {}): Promise<string[]> => {
  const r = await getProfileListPage(
    { ownerId, viewerId: ownerId, tab: 'lists', ...f },
    { limit: 50 },
  )
  return r.items.map((i) => i.slug)
}

describe('поиск и фильтры своих списков', () => {
  it('без отбора видны все свои, включая черновик и приватный', async () => {
    expect((await page()).sort()).toEqual(['forked-one', 'private-notes', 'redis-cheatsheet', 'redis-draft'])
  })

  it('поиск идёт и по названию, и по адресу', async () => {
    expect((await page({ query: 'шпаргалка' })).sort()).toEqual(['redis-cheatsheet'])
    expect((await page({ query: 'redis' })).sort(), 'адрес тоже считается').toEqual(['redis-cheatsheet', 'redis-draft'])
  })

  it('черновик и приватный — разные состояния, а не одно поле', async () => {
    expect(await page({ listType: 'draft' })).toEqual(['redis-draft'])
    expect(await page({ listType: 'private' })).toEqual(['private-notes'])
    // ⚠️ У черновика поле visibility говорит лишь о том, каким список СТАНЕТ: по нему
    // фильтровать нельзя, иначе «публичные» включают неопубликованное.
    // Форк тоже публичный: происхождение и видимость — разные оси, и «публичные»
    // включают форк по праву. Ожидание «только не-форки» было бы моей выдумкой.
    expect((await page({ listType: 'public' })).sort()).toEqual(['forked-one', 'redis-cheatsheet'])
    expect(await page({ listType: 'forks' })).toEqual(['forked-one'])
  })

  it('счёт совпадает с выдачей при любом отборе', async () => {
    for (const f of [{}, { query: 'redis' }, { listType: 'draft' as const }, { query: 'нет-такого' }]) {
      const r = await getProfileListPage({ ownerId, viewerId: ownerId, tab: 'lists', ...f }, { limit: 50 })
      expect(r.total, JSON.stringify(f)).toBe(r.items.length)
    }
  })
})

describe('сохранённый запрос', () => {
  it('сужает набор и СОСТАВЛЯЕТСЯ с поиском', async () => {
    const ids = [idBySlug.get('redis-cheatsheet')!, idBySlug.get('private-notes')!]
    expect((await page({ ids })).sort()).toEqual(['private-notes', 'redis-cheatsheet'])
    expect(await page({ ids, query: 'redis' }), 'поиск внутри сохранённого запроса').toEqual(['redis-cheatsheet'])
  })

  it('пустой сохранённый запрос — это «ничего не подошло», а не «фильтра нет»', async () => {
    expect(await page({ ids: [] })).toEqual([])
  })
})
