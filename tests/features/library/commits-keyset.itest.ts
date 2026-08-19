import { beforeEach, describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor } from '@/shared/lib/paging'
import { resetTables } from '../../helpers/reset-db'

/**
 * ИСТОРИЯ ВЕРСИЙ — самая длинная выдача на сайте: каждая правка добавляет строку навсегда.
 * Отдавалась целиком, без предела вовсе.
 *
 * Ключ здесь ЦЕЛЫЙ — номер версии, а не время. Он уникален в пределах списка и монотонен,
 * тогда как время у пачки версий от одной операции (импорт, проход садовника) совпадает
 * сплошь и рядом. Поэтому корпус ниже нарочно создан с ОДНИМ временем на все версии: по
 * времени порядок был бы произволен, по номеру — строг.
 */

const { db, templates, templateVersions, users } = await import('@/shared/db')
const { countCommits, getCommitAuthors, getCommitsPage } = await import('@/features/library/queries')

const COUNT = 9
const PER = 3
let templateId = ''

const seed = async (): Promise<void> => {
  await resetTables([templateVersions, templates, users])
  const [u] = await db.insert(users).values({ handle: 'commit-author' }).returning({ id: users.id })
  const [other] = await db.insert(users).values({ handle: 'commit-guest' }).returning({ id: users.id })
  const [tpl] = await db
    .insert(templates)
    .values({ ownerId: u.id, slug: 'history-list', title: { ru: 'и' } })
    .returning({ id: templates.id })
  templateId = tpl.id
  await db.insert(templateVersions).values(
    Array.from({ length: COUNT }, (_, i) => ({
      templateId,
      version: i + 1,
      note: `правка ${i + 1}`,
      authorId: i % 2 === 0 ? u.id : other.id,
      // ОДНО время на всю историю: по нему порядок неотличим, и работать обязан номер.
      createdAt: new Date(Date.UTC(2026, 7, 18, 12, 0, 0)),
    })),
  )
}

beforeEach(seed)

describe('история версий листается ключом-номером', () => {
  it('первая порция — САМЫЕ СВЕЖИЕ версии', async () => {
    const page = await getCommitsPage(templateId, PER)
    expect(page.items.map((c) => c.version)).toEqual([9, 8, 7])
    expect(page.prev).toBeNull()
  })

  it('обход даёт всю историю по убыванию номера и без повторов', async () => {
    const seen: number[] = []
    let cursor = null as ReturnType<typeof decodeCursor>
    for (let i = 0; i < 10; i++) {
      const page = await getCommitsPage(templateId, PER, cursor)
      seen.push(...page.items.map((c) => c.version))
      if (!page.next) break
      cursor = decodeCursor(page.next, 'int')
    }
    // Одно время на все версии: если бы ключом было оно, порядок здесь и поехал бы.
    expect(seen).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1])
  })

  it('шаг назад возвращает ровно ту порцию, с которой ушли', async () => {
    const first = await getCommitsPage(templateId, PER)
    const second = await getCommitsPage(templateId, PER, decodeCursor(first.next, 'int'))
    const back = await getCommitsPage(templateId, PER, decodeCursor(second.prev, 'int'), 'before')
    expect(back.items.map((c) => c.version)).toEqual(first.items.map((c) => c.version))
  })

  it('курсор ленты сюда не подходит и отсеивается, а не роняет страницу', async () => {
    // Ключи разных типов: подставленный в адрес истории курсор от ленты доехал бы до
    // `'2026-08-18 …'::int`. Проверка типа обязана отсечь его раньше.
    const feedCursor = encodeCursor({ key: '2026-08-18 19:02:03.092835+00', id: crypto.randomUUID() })
    expect(decodeCursor(feedCursor, 'int')).toBeNull()
    // И наоборот: целый ключ не пролезает туда, где ждут время.
    expect(decodeCursor(encodeCursor({ key: '7', id: crypto.randomUUID() }), 'time')).toBeNull()
  })

  it('отбор по автору идёт В ЗАПРОСЕ: порция полна, а не «сколько подошло»', async () => {
    // Автор чередуется, значит его правок ровно пять из девяти. Фильтруй мы после окна —
    // первая порция показала бы две строки вместо трёх.
    const page = await getCommitsPage(templateId, PER, null, 'after', { authorHandle: 'commit-author' })
    expect(page.items).toHaveLength(PER)
    expect(page.items.every((c) => c.author?.handle === 'commit-author')).toBe(true)
    expect(page.items.map((c) => c.version)).toEqual([9, 7, 5])
  })

  it('отбор переносится и на следующую порцию', async () => {
    const first = await getCommitsPage(templateId, PER, null, 'after', { authorHandle: 'commit-author' })
    const second = await getCommitsPage(templateId, PER, decodeCursor(first.next, 'int'), 'after', {
      authorHandle: 'commit-author',
    })
    expect(second.items.map((c) => c.version)).toEqual([3, 1])
    expect(second.next).toBeNull()
  })

  it('число в шапке — по всему списку, а не по показанному и не по отбору', async () => {
    expect(await countCommits(templateId)).toBe(COUNT)
  })

  it('авторы фильтра не зависят от показанной порции', async () => {
    const authors = await getCommitAuthors(templateId)
    expect(authors.map((a) => a.handle)).toEqual(['commit-author', 'commit-guest'])
  })
})
