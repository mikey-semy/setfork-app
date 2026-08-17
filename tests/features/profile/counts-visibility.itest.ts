import { beforeAll, describe, expect, it } from 'vitest'
import { db, repositories, stars, templates, users } from '@/shared/db'
import { getOwnerCatalogs } from '@/features/catalogs/queries'
import { getPopularTags, getTemplatesByIds } from '@/features/library/queries'
import { getProfileCounts, getStarredListKeys } from '@/features/profile/queries'
import { resetTables } from '../../helpers/reset-db'

describe('видимые счётчики профиля', () => {
  let ownerId = ''
  let viewerId = ''

  beforeAll(async () => {
    await resetTables([stars, templates, repositories, users])
    const [owner, viewer] = await db
      .insert(users)
      .values([{ handle: 'profile-count-owner' }, { handle: 'profile-count-viewer' }])
      .returning({ id: users.id })
    ownerId = owner.id
    viewerId = viewer.id

    const [catalog] = await db
      .insert(repositories)
      .values({ ownerId, name: 'visible-counts', title: { en: 'Visible counts' } })
      .returning({ id: repositories.id })

    const rows = await db
      .insert(templates)
      .values([
        {
          ownerId,
          repositoryId: catalog.id,
          slug: 'published',
          title: { en: 'Published' },
          tags: ['shared', 'public-only'],
        },
        {
          ownerId,
          repositoryId: catalog.id,
          slug: 'draft',
          title: { en: 'Draft' },
          tags: ['shared', 'draft-only'],
          status: 'draft',
        },
        {
          ownerId,
          repositoryId: catalog.id,
          slug: 'private',
          title: { en: 'Private' },
          tags: ['private-only'],
          visibility: 'private',
        },
      ])
      .returning({ id: templates.id })
    await db.insert(stars).values(rows.map((row) => ({ userId: ownerId, templateId: row.id })))
  })

  it('не подтверждает зрителю существование черновиков и приватных списков', async () => {
    await expect(getProfileCounts(ownerId, viewerId)).resolves.toMatchObject({ lists: 1, stars: 1 })
    await expect(getProfileCounts(ownerId)).resolves.toMatchObject({ lists: 1, stars: 1 })
  })

  it('владельцу считает весь набор, который виден в его вкладках', async () => {
    await expect(getProfileCounts(ownerId, ownerId)).resolves.toMatchObject({ lists: 3, stars: 3 })
  })

  it('считает списки в каталоге без сломанного коррелированного подзапроса', async () => {
    await expect(getOwnerCatalogs(ownerId, viewerId)).resolves.toEqual([
      expect.objectContaining({ name: 'visible-counts', listCount: 1 }),
    ])
    await expect(getOwnerCatalogs(ownerId, ownerId)).resolves.toEqual([
      expect.objectContaining({ name: 'visible-counts', listCount: 3 }),
    ])
  })

  it('во вкладке Starred владелец видит и черновик, и опубликованный — с их статусами', async () => {
    // Проверяем ОБЕ половины позднего доступа к строке разом: ключи решают, что попадёт
    // на страницу, строки приезжают отдельным запросом. Пройди только первая — страница
    // молча стала бы короче обещанного её номером.
    const keys = await getStarredListKeys(ownerId, ownerId)
    expect(keys.map((k) => k.slug)).toEqual(expect.arrayContaining(['draft', 'published']))
    const items = await getTemplatesByIds(
      keys.map((k) => k.id),
      ownerId,
    )
    expect(items).toHaveLength(keys.length)
    expect(items.find((item) => item.slug === 'draft')?.status).toBe('draft')
    expect(items.find((item) => item.slug === 'published')?.status).toBe('published')
  })

  it('чужие ключи не превращаются в строки: выборка по id гейтит сама', async () => {
    // id приходят из отфильтрованной выборки, но запрос по id обязан быть безопасным и
    // сам по себе — иначе однажды переданный снаружи список id откроет приватные.
    const own = await getStarredListKeys(ownerId, ownerId)
    const asStranger = await getTemplatesByIds(
      own.map((k) => k.id),
      viewerId,
    )
    expect(asStranger.map((i) => i.slug)).not.toContain('draft')
  })

  it('считает популярные теги по видимым спискам, а не по устаревшему реестру', async () => {
    const tags = await getPopularTags(300)
    expect(tags).toEqual(
      expect.arrayContaining([
        { tag: 'public-only', count: 1 },
        { tag: 'shared', count: 1 },
      ]),
    )
    expect(tags).not.toEqual(expect.arrayContaining([expect.objectContaining({ tag: 'draft-only' }), expect.objectContaining({ tag: 'private-only' })]))
  })
})
