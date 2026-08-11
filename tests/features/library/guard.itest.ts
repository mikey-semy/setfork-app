import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// Чокпоинт чтения requireViewableMeta против реального Postgres: приватное/черновик —
// только владельцу (даже НЕ админу), снятое модерацией — владельцу или админу,
// публичное+published+active — всем. Это та самая единая точка, через которую
// обязаны идти читающие роуты (ESLint-барьер это гарантирует). Мокаем только сессию
// и isAdminHandle; getListMeta + canViewList — настоящие.
const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({ getSession: async () => h.session }))
vi.mock('@/shared/auth/admin', () => ({ isAdminHandle: (handle?: string | null) => handle === 'theadmin' }))

const { db, templates, users } = await import('@/shared/db')
const { requireViewableMeta } = await import('@/features/library/guard')

const OWNER = 'gowner'
let ownerId = ''
let viewerId = ''
let adminId = ''

const anon = null
const asViewer = () => ({ userId: viewerId, handle: 'gviewer' })
const asOwner = () => ({ userId: ownerId, handle: OWNER })
const asAdmin = () => ({ userId: adminId, handle: 'theadmin' })

async function seed(slug: string, over: Partial<typeof templates.$inferInsert>): Promise<void> {
  await db.insert(templates).values({ ownerId, slug, title: { en: slug }, ...over })
}
/** true, если чокпоинт отдал мету при данной сессии. */
async function canSee(session: ReturnType<typeof asViewer> | null, slug: string): Promise<boolean> {
  h.session = session
  return !!(await requireViewableMeta(OWNER, slug))
}

beforeAll(async () => {
  await resetTables([templates, users])
  const [o] = await db.insert(users).values({ handle: OWNER }).returning({ id: users.id })
  const [v] = await db.insert(users).values({ handle: 'gviewer' }).returning({ id: users.id })
  const [a] = await db.insert(users).values({ handle: 'theadmin' }).returning({ id: users.id })
  ownerId = o.id
  viewerId = v.id
  adminId = a.id
  await seed('pub', {}) // дефолт: public + published + active
  await seed('priv', { visibility: 'private' })
  await seed('draft', { status: 'draft' })
  await seed('flag', { moderation: 'flagged' })
})
afterAll(async () => {
  await resetTables([templates, users])
})

describe('requireViewableMeta — чокпоинт чтения', () => {
  it('публичный published+active — виден всем (аноним/чужой/владелец/админ)', async () => {
    expect(await canSee(anon, 'pub')).toBe(true)
    expect(await canSee(asViewer(), 'pub')).toBe(true)
    expect(await canSee(asOwner(), 'pub')).toBe(true)
    expect(await canSee(asAdmin(), 'pub')).toBe(true)
  })

  it('приватный — только владелец (даже админ НЕ видит)', async () => {
    expect(await canSee(anon, 'priv')).toBe(false)
    expect(await canSee(asViewer(), 'priv')).toBe(false)
    expect(await canSee(asAdmin(), 'priv')).toBe(false)
    expect(await canSee(asOwner(), 'priv')).toBe(true)
  })

  it('черновик — только владелец (админ НЕ видит)', async () => {
    expect(await canSee(anon, 'draft')).toBe(false)
    expect(await canSee(asViewer(), 'draft')).toBe(false)
    expect(await canSee(asAdmin(), 'draft')).toBe(false)
    expect(await canSee(asOwner(), 'draft')).toBe(true)
  })

  it('снятый модерацией (flagged) — владелец ИЛИ админ, чужой/аноним нет', async () => {
    expect(await canSee(anon, 'flag')).toBe(false)
    expect(await canSee(asViewer(), 'flag')).toBe(false)
    expect(await canSee(asOwner(), 'flag')).toBe(true)
    expect(await canSee(asAdmin(), 'flag')).toBe(true)
  })

  it('несуществующий список → null', async () => {
    expect(await canSee(asOwner(), 'nope-404')).toBe(false)
  })
})
