import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, templates, users } from '@/shared/db'
import { getFeed } from '@/features/library/queries'
import { resetTables } from '../../helpers/reset-db'

// Интеграция data-layer: SQL-предикат видимости `visibleFilter` (через getFeed) —
// это read-authz на уровне запроса, парная к canViewList (unit — core/domain/access).
// Проверяем на РЕАЛЬНОЙ БД: приватный / черновик / снятый модерацией список НЕ утекает
// в ленту не-владельцу, а владелец видит свои. Дыры типа blame/versions рождались
// именно из забытого фильтра — тут он проверен сквозняком.

let ownerId = ''
let otherId = ''
const ids: Record<'pub' | 'priv' | 'draft' | 'flagged', string> = { pub: '', priv: '', draft: '', flagged: '' }

async function seedList(ownerId: string, slug: string, over: Partial<typeof templates.$inferInsert>): Promise<string> {
  const [row] = await db
    .insert(templates)
    .values({ ownerId, slug, title: { en: slug }, ...over })
    .returning({ id: templates.id })
  return row.id
}

beforeAll(async () => {
  await resetTables(sql`${templates}, ${users}`)
  const [owner] = await db.insert(users).values({ handle: 'itest-owner' }).returning({ id: users.id })
  const [other] = await db.insert(users).values({ handle: 'itest-other' }).returning({ id: users.id })
  ownerId = owner.id
  otherId = other.id
  // Дефолты таблицы = public + published + active (виден всем); остальные — переопределяем.
  ids.pub = await seedList(ownerId, 'pub-list', {})
  ids.priv = await seedList(ownerId, 'priv-list', { visibility: 'private' })
  ids.draft = await seedList(ownerId, 'draft-list', { status: 'draft' })
  ids.flagged = await seedList(ownerId, 'flagged-list', { moderation: 'flagged' })
})

afterAll(async () => {
  await resetTables(sql`${templates}, ${users}`)
})

const feedIds = async (viewerId?: string) => new Set((await getFeed({}, viewerId)).map((r) => r.id))

describe('visibleFilter через getFeed (read-authz на уровне БД)', () => {
  it('аноним видит только public+published+active', async () => {
    const s = await feedIds(undefined)
    expect(s.has(ids.pub)).toBe(true)
    expect(s.has(ids.priv)).toBe(false)
    expect(s.has(ids.draft)).toBe(false)
    expect(s.has(ids.flagged)).toBe(false)
  })

  it('чужой залогиненный — так же не видит приватное/черновик/снятое', async () => {
    const s = await feedIds(otherId)
    expect(s.has(ids.pub)).toBe(true)
    expect([ids.priv, ids.draft, ids.flagged].some((id) => s.has(id))).toBe(false)
  })

  it('владелец видит СВОИ приватный/черновик/снятый', async () => {
    const s = await feedIds(ownerId)
    for (const id of Object.values(ids)) expect(s.has(id), id).toBe(true)
  })
})
