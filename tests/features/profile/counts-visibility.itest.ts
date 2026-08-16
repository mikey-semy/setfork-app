import { beforeAll, describe, expect, it } from 'vitest'
import { db, repositories, stars, templates, users } from '@/shared/db'
import { getOwnerCatalogs } from '@/features/catalogs/queries'
import { getPopularTags } from '@/features/library/queries'
import { getProfileCounts, getStarredTemplates } from '@/features/profile/queries'
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

  it('возвращает статус для общей карточки во вкладке Starred', async () => {
    const items = await getStarredTemplates(ownerId, ownerId)
    expect(items.find((item) => item.slug === 'draft')?.status).toBe('draft')
    expect(items.find((item) => item.slug === 'published')?.status).toBe('published')
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
