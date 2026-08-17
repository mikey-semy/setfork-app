import { beforeAll, describe, expect, it } from 'vitest'
import { db, repositories, starFolderItems, starFolders, stars, templates, users } from '@/shared/db'
import { countUnfiledLists, getProfileListIds, getProfileListPage } from '@/features/library/queries'
import { LISTS_PER_PAGE, pageWindow } from '@/shared/lib/paging'
import { resetTables } from '../../helpers/reset-db'

/**
 * ПРАВИЛА ВЫДАЧИ ВКЛАДОК ПРОФИЛЯ. Раньше они жили в памяти (`selectItems`) и проверялись
 * юнит-тестом над массивом. Теперь это SQL, и проверять его массивом бессмысленно: там,
 * где ошибётся запрос, чистая функция была права. Поэтому тест переехал на живую базу —
 * с ним же переехали и правила, которых в памяти не было: видимость и однозначный порядок.
 */

const win = pageWindow(1)

describe('выдача вкладок профиля', () => {
  let ownerId = ''
  let strangerId = ''
  let shelfId = ''
  let folderId = ''

  beforeAll(async () => {
    await resetTables([starFolderItems, starFolders, stars, templates, repositories, users])
    const [owner, stranger] = await db
      .insert(users)
      .values([{ handle: 'sel-owner' }, { handle: 'sel-stranger' }])
      .returning({ id: users.id })
    ownerId = owner.id
    strangerId = stranger.id

    const [shelf, otherShelf] = await db
      .insert(repositories)
      .values([
        { ownerId, name: 'devops', title: { en: 'DevOps' } },
        { ownerId, name: 'cooking', title: { en: 'Cooking' } },
      ])
      .returning({ id: repositories.id })
    shelfId = shelf.id

    await db.insert(templates).values([
      // На полке, публичный, ищется словом «deploy» и по заголовку.
      { ownerId, repositoryId: shelf.id, slug: 'deploy-public', title: { en: 'Deploy to VPS' }, starsCount: 5 },
      // На полке, приватный — чужому не виден.
      { ownerId, repositoryId: shelf.id, slug: 'deploy-secret', title: { en: 'Deploy secrets' }, visibility: 'private', starsCount: 5 },
      // На ДРУГОЙ полке.
      { ownerId, repositoryId: otherShelf.id, slug: 'bread-baking', title: { en: 'Bread', ru: 'Хлебопечка' }, starsCount: 9 },
      // Без полки — очередь разбора.
      { ownerId, slug: 'unfiled-one', title: { en: 'Unfiled one' }, starsCount: 1 },
      // Без полки и форк.
      { ownerId, slug: 'unfiled-fork', title: { en: 'Unfiled fork' }, origin: 'forked', starsCount: 1 },
    ])
  })

  // Функцией, а не константой: id появляются только в beforeAll, а тело describe
  // выполняется раньше — константа замкнула бы пустые строки.
  const own = () => ({ ownerId, viewerId: ownerId, tab: 'lists' as const })
  const page = (over: Record<string, unknown> = {}) => getProfileListPage({ ...own(), ...over }, win)
  const slugs = async (over: Record<string, unknown> = {}) => (await page(over)).items.map((i) => i.slug)

  describe('фильтр по полке', () => {
    it('без фильтра видно всё своё', async () => {
      await expect(page()).resolves.toMatchObject({ total: 5 })
    })

    it('полка показывает только своё', async () => {
      expect((await slugs({ catalogId: shelfId })).sort()).toEqual(['deploy-public', 'deploy-secret'])
    })

    it('«без полки» — это очередь разбора, а не «фильтр не задан»', async () => {
      expect((await slugs({ catalogId: null })).sort()).toEqual(['unfiled-fork', 'unfiled-one'])
      await expect(countUnfiledLists(ownerId, ownerId)).resolves.toBe(2)
    })

    it('фильтр полки складывается с поиском и типом, а не спорит с ними', async () => {
      expect(await slugs({ catalogId: shelfId, listType: 'private', query: 'deploy' })).toEqual(['deploy-secret'])
    })
  })

  describe('прежние правила не сломаны', () => {
    it('поиск идёт и по слагу, и по заголовку — на обоих языках', async () => {
      expect(await slugs({ query: 'bread' })).toEqual(['bread-baking'])
      expect(await slugs({ query: 'хлебопечка' })).toEqual(['bread-baking'])
      expect(await slugs({ query: 'unfiled' })).toHaveLength(2)
    })

    it('порядок по имени и по звёздам', async () => {
      expect(await slugs({ sort: 'name' })).toEqual(['bread-baking', 'deploy-public', 'deploy-secret', 'unfiled-fork', 'unfiled-one'])
      expect((await slugs({ sort: 'stars' }))[0]).toBe('bread-baking')
    })

    it('форки отбираются по происхождению, а не по видимости', async () => {
      expect(await slugs({ listType: 'forks' })).toEqual(['unfiled-fork'])
    })
  })

  describe('чего в памяти не проверялось', () => {
    it('чужой не видит приватных — ни в выдаче, ни в счёте', async () => {
      const asStranger = await getProfileListPage({ ownerId, viewerId: strangerId, tab: 'lists' }, win)
      expect(asStranger.total).toBe(4)
      expect(asStranger.items.map((i) => i.slug)).not.toContain('deploy-secret')
      // И аноним тоже.
      await expect(getProfileListPage({ ownerId, tab: 'lists' }, win)).resolves.toMatchObject({ total: 4 })
    })

    it('порядок однозначен при равных звёздах: страницы не теряют и не дублируют строк', async () => {
      // Три списка с одинаковым счётом звёзд — ровно тот случай, где база вправе вернуть
      // их в любом порядке, а страницы начинают расходиться между собой.
      const seen: string[] = []
      for (let p = 1; p <= 5; p++) {
        const { items } = await getProfileListPage({ ...own(), sort: 'stars' }, pageWindow(p, 1))
        seen.push(...items.map((i) => i.slug))
      }
      expect(seen).toHaveLength(5)
      expect(new Set(seen).size).toBe(5)
      // Повтор того же обхода обязан дать тот же порядок — иначе он не порядок.
      const again: string[] = []
      for (let p = 1; p <= 5; p++) {
        const { items } = await getProfileListPage({ ...own(), sort: 'stars' }, pageWindow(p, 1))
        again.push(...items.map((i) => i.slug))
      }
      expect(again).toEqual(seen)
    })

    it('окно режется в запросе, а счёт считает всю выдачу', async () => {
      const first = await getProfileListPage({ ...own(), sort: 'name' }, pageWindow(1, 2))
      const second = await getProfileListPage({ ...own(), sort: 'name' }, pageWindow(2, 2))
      expect(first.items.map((i) => i.slug)).toEqual(['bread-baking', 'deploy-public'])
      expect(second.items.map((i) => i.slug)).toEqual(['deploy-secret', 'unfiled-fork'])
      expect(first.total).toBe(5)
      expect(second.total).toBe(5)
    })

    it('«выбрать все» берёт всю выдачу с фильтром, а не показанную страницу', async () => {
      const ids = await getProfileListIds({ ...own(), catalogId: null }, LISTS_PER_PAGE)
      expect(ids).toHaveLength(2)
    })

    it('кривой потолок пачки не роняет вкладку', async () => {
      // BULK_MAX приходит из квоты, а та из env: `envNumber` пропускает и 0, и дробь.
      // Это потолок, а не окно страницы, поэтому уронить им вкладку владельца нельзя.
      await expect(getProfileListIds(own(), 0)).resolves.toHaveLength(1)
      await expect(getProfileListIds(own(), 2.7)).resolves.toHaveLength(2)
    })
  })

  describe('звёзды и папки', () => {
    beforeAll(async () => {
      const rows = await db.select({ id: templates.id, slug: templates.slug }).from(templates)
      await db.insert(stars).values(rows.map((r) => ({ userId: ownerId, templateId: r.id })))
      const [folder] = await db.insert(starFolders).values({ userId: ownerId, name: 'to-read' }).returning({ id: starFolders.id })
      folderId = folder.id
      const bread = rows.find((r) => r.slug === 'bread-baking')!
      await db.insert(starFolderItems).values({ folderId, templateId: bread.id })
    })

    it('папка звёзд отбирает свои строки', async () => {
      const res = await getProfileListPage({ ownerId, viewerId: ownerId, tab: 'starred', folder: 'to-read' }, win)
      expect(res.items.map((i) => i.slug)).toEqual(['bread-baking'])
      expect(res.total).toBe(1)
    })

    it('несуществующая папка фильтром не считается — как и неизвестная полка', async () => {
      // Иначе опечатка в адресе показывает пустую вкладку, и об этом неоткуда узнать.
      const res = await getProfileListPage({ ownerId, viewerId: ownerId, tab: 'starred', folder: 'no-such-folder' }, win)
      expect(res.total).toBe(5)
    })

    it('на вкладке звёзд полки не применяются: там свои папки', async () => {
      const res = await getProfileListPage({ ownerId, viewerId: ownerId, tab: 'starred', catalogId: null }, win)
      expect(res.total).toBe(5)
    })

    it('чужие звёзды не показывают приватное владельца', async () => {
      const res = await getProfileListPage({ ownerId, viewerId: strangerId, tab: 'starred' }, win)
      expect(res.items.map((i) => i.slug)).not.toContain('deploy-secret')
      expect(res.total).toBe(4)
    })
  })
})
