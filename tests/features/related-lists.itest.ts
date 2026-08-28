import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { getRelatedLists } from '@/features/library/queries'
import { db, templates, users } from '@/shared/db'

/**
 * Блок «связанные списки» — это внутренняя перелинковка, то есть публикация ссылок.
 * Поэтому проверяется не «нашлось ли что-нибудь», а порядок и границы: сильнее
 * совпадение — выше; сам список себе не сосед; черновик и приватный не показываются
 * никому, включая владельца.
 */
const OWNER = 'rel-owner'
const ctx: Record<string, string> = {}

async function makeList(slug: string, tags: string[], patch: Partial<typeof templates.$inferInsert> = {}) {
  const [t] = await db
    .insert(templates)
    .values({ ownerId: ctx.owner, slug, title: { en: slug }, tags, ...patch })
    .returning({ id: templates.id })
  return t.id
}

beforeEach(async () => {
  await db.delete(users).where(eq(users.handle, OWNER))
  const [o] = await db.insert(users).values({ handle: OWNER, name: 'Owner' }).returning({ id: users.id })
  ctx.owner = o.id
})

describe('соседи по тегам', () => {
  it('чем больше общих тегов, тем выше', async () => {
    const id = await makeList('rel-source', ['deploy', 'caddy', 'vps'])
    await makeList('rel-one-tag', ['deploy'])
    await makeList('rel-two-tags', ['deploy', 'caddy'])

    const found = await getRelatedLists({ id, tags: ['deploy', 'caddy', 'vps'] })

    expect(found.map((f) => f.slug)).toEqual(['rel-two-tags', 'rel-one-tag'])
  })

  it('сам себе не сосед', async () => {
    const id = await makeList('rel-source', ['deploy'])

    const found = await getRelatedLists({ id, tags: ['deploy'] })

    expect(found.map((f) => f.slug)).not.toContain('rel-source')
  })

  it('черновик, приватный и снятый модерацией не попадают', async () => {
    const id = await makeList('rel-source', ['deploy'])
    await makeList('rel-draft', ['deploy'], { status: 'draft' })
    await makeList('rel-private', ['deploy'], { visibility: 'private' })
    await makeList('rel-pending', ['deploy'], { moderation: 'pending' })
    await makeList('rel-ok', ['deploy'])

    const found = await getRelatedLists({ id, tags: ['deploy'] })

    expect(found.map((f) => f.slug)).toEqual(['rel-ok'])
  })

  it('у списка без тегов соседей нет — и в базу за ними не ходим', async () => {
    const id = await makeList('rel-source', [])
    await makeList('rel-other', ['deploy'])

    expect(await getRelatedLists({ id, tags: [] })).toEqual([])
  })

  it('потолок соблюдается', async () => {
    const id = await makeList('rel-source', ['deploy'])
    for (let n = 0; n < 5; n++) await makeList(`rel-n${n}`, ['deploy'])

    expect(await getRelatedLists({ id, tags: ['deploy'] }, 3)).toHaveLength(3)
  })
})
