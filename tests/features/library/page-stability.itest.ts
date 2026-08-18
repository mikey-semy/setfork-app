import { beforeAll, describe, expect, it } from 'vitest'
import { pageWindow } from '@/shared/lib/paging'
import { resetTables } from '../../helpers/reset-db'

/**
 * УСТОЙЧИВОСТЬ СТРАНИЦ на всех листающихся поверхностях, кроме вкладок профиля —
 * у тех своя проверка (features/profile/profile-lists.itest). Пункт 3 Фазы 1 трека
 * пагинации: «ни одна листающаяся поверхность не может показать строку дважды».
 *
 * Метод один на все: обход ПО ОДНОЙ СТРОКЕ через настоящие окна страниц. Сколько строк
 * в корпусе — столько страниц по одной; склеенные подряд, они обязаны дать ровно
 * исходный корпус, без пропусков и повторов. Затем тот же обход повторяется и обязан
 * совпасть дословно: порядок, который не воспроизводится, не порядок.
 *
 * Условие, без которого проверка пустая: у ВСЕХ списков один и тот же `updated_at`.
 * Ключ сортировки совпадает у всего корпуса, поэтому единственное, что делает порядок
 * однозначным, — доопределение до `id`. Разные даты сделали бы тест зелёным при
 * полностью убранном доопределении.
 *
 * Окно берётся из `pageWindow`, а не считается на месте: проверяется поверхность целиком,
 * вместе с тем, как страница переводится в предел и смещение.
 */

const { db, repositories, templates, users } = await import('@/shared/db')
const { getFeed, getListsInCatalog, getUserTemplates } = await import('@/features/library/queries')

const COUNT = 7
const TAG = 'устойчивость'
/** Одна дата на весь корпус — равные ключи сортировки у всех строк до последней. */
const SAME = new Date('2026-08-18T12:00:00.000Z')

let ownerId = ''
let catalogId = ''
let slugs: string[] = []

beforeAll(async () => {
  await resetTables([templates, repositories, users])
  const [owner] = await db.insert(users).values({ handle: 'stab-owner' }).returning({ id: users.id })
  ownerId = owner.id
  const [repo] = await db
    .insert(repositories)
    .values({ ownerId, name: 'stab-catalog', title: { ru: 'полка' } })
    .returning({ id: repositories.id })
  catalogId = repo.id

  const rows = await db
    .insert(templates)
    .values(
      Array.from({ length: COUNT }, (_, i) => ({
        ownerId,
        slug: `stab-${i}`,
        title: { ru: `устойчивость ${i}` },
        tags: [TAG],
        repositoryId: catalogId,
        updatedAt: SAME,
      })),
    )
    .returning({ slug: templates.slug })
  slugs = rows.map((r) => r.slug)
  expect(slugs).toHaveLength(COUNT)
})

/** Обход всего корпуса окнами по одной строке. */
const walk = async (page: (w: { limit: number; offset?: number }) => Promise<{ slug: string }[]>): Promise<string[]> => {
  const seen: string[] = []
  for (let p = 1; p <= COUNT; p++) seen.push(...(await page(pageWindow(p, 1))).map((r) => r.slug))
  return seen
}

/** Обход даёт весь корпус без повторов И повторяется дословно. */
const expectStable = async (page: (w: { limit: number; offset?: number }) => Promise<{ slug: string }[]>): Promise<void> => {
  const first = await walk(page)
  expect(first).toHaveLength(COUNT)
  expect(new Set(first).size).toBe(COUNT)
  expect([...first].sort()).toEqual([...slugs].sort())
  expect(await walk(page)).toEqual(first)
}

describe('страницы не теряют и не дублируют строк', () => {
  it('«мои списки» и панель главной (getUserTemplates)', async () => {
    await expectStable((w) => getUserTemplates(ownerId, ownerId, w))
  })

  it('полка каталога (getListsInCatalog)', async () => {
    await expectStable((w) => getListsInCatalog(catalogId, ownerId, w))
  })

  it('просмотр по тегу (keywordFeed через getFeed)', async () => {
    await expectStable((w) => getFeed({ tag: TAG }, ownerId, undefined, w))
  })

  it('выдача поиска БЕЗ слов — окно уезжает в SQL', async () => {
    // Именно этот путь листается страницами: с запросом словами выдача склеивается в
    // памяти и ограничена потолком настроек (см. getSearchPage).
    await expectStable((w) => getFeed({ sort: 'newest' }, ownerId, undefined, w))
  })

  it('порядок один и тот же, каким бы окном его ни резать', async () => {
    // Страницы по одной строке, по две и целиком обязаны описывать ОДНУ
    // последовательность. Расхождение здесь означало бы, что порядок зависит от
    // предела — то есть его нет вовсе.
    const byOne = await walk((w) => getUserTemplates(ownerId, ownerId, w))
    const byTwo: string[] = []
    for (let p = 1; p <= Math.ceil(COUNT / 2); p++) {
      byTwo.push(...(await getUserTemplates(ownerId, ownerId, pageWindow(p, 2))).map((r) => r.slug))
    }
    const whole = (await getUserTemplates(ownerId, ownerId, { limit: COUNT })).map((r) => r.slug)
    expect(byTwo).toEqual(byOne)
    expect(whole).toEqual(byOne)
  })
})
