import { beforeAll, describe, expect, it } from 'vitest'
import { db, stars, templates, users } from '@/shared/db'
import { getProfileCounts } from '@/features/profile/queries'
import { resetTables } from '../../helpers/reset-db'

describe('видимые счётчики профиля', () => {
  let ownerId = ''
  let viewerId = ''

  beforeAll(async () => {
    await resetTables([stars, templates, users])
    const [owner, viewer] = await db
      .insert(users)
      .values([{ handle: 'profile-count-owner' }, { handle: 'profile-count-viewer' }])
      .returning({ id: users.id })
    ownerId = owner.id
    viewerId = viewer.id

    const rows = await db
      .insert(templates)
      .values([
        { ownerId, slug: 'published', title: { en: 'Published' } },
        { ownerId, slug: 'draft', title: { en: 'Draft' }, status: 'draft' },
        { ownerId, slug: 'private', title: { en: 'Private' }, visibility: 'private' },
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
})
