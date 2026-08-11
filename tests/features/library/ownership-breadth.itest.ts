import { and, eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// Ширь ownership/видимости для остальных library-экшенов против реального Postgres.
// Мокаем границу Next (сессия, revalidatePath) и уведомления; БД и проверки настоящие.
const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => {
    if (!h.session) throw new Error('no session')
    return h.session
  },
  getSession: async () => h.session,
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/features/notifications/notify', () => ({ notify: async () => {}, notifyMany: async () => {}, notifyMentions: async () => {} }))

const { db, templates, users, stars } = await import('@/shared/db')
const { setListPinned, setListTemplate, updatePins, toggleStar } = await import('@/features/library/actions')

let ownerId = ''
let otherId = ''

async function seedList(owner: string, over: Partial<typeof templates.$inferInsert> = {}): Promise<string> {
  const [t] = await db
    .insert(templates)
    .values({ ownerId: owner, slug: `b-${Math.random().toString(36).slice(2)}`, title: { en: 'B' }, ...over })
    .returning({ id: templates.id })
  return t.id
}
const tpl = async (id: string) => db.query.templates.findFirst({ where: (t, { eq: e }) => e(t.id, id) })
const isStarred = async (userId: string, templateId: string) =>
  !!(await db.select({ id: stars.id }).from(stars).where(and(eq(stars.userId, userId), eq(stars.templateId, templateId))).limit(1)).length

beforeEach(async () => {
  await resetTables([templates, users])
  const [o] = await db.insert(users).values({ handle: 'bowner' }).returning({ id: users.id })
  const [x] = await db.insert(users).values({ handle: 'bother' }).returning({ id: users.id })
  ownerId = o.id
  otherId = x.id
})
afterEach(() => {
  h.session = null
})

describe('setListPinned / setListTemplate — только владелец', () => {
  it('не-владелец не меняет pinned/isTemplate чужого списка', async () => {
    const id = await seedList(ownerId)
    h.session = { userId: otherId, handle: 'bother' }
    await setListPinned(id, true)
    await setListTemplate(id, true)
    const r = await tpl(id)
    expect(r?.pinned).toBe(false)
    expect(r?.isTemplate).toBe(false)
  })

  it('владелец меняет свои pinned/isTemplate', async () => {
    const id = await seedList(ownerId)
    h.session = { userId: ownerId, handle: 'bowner' }
    await setListPinned(id, true)
    await setListTemplate(id, true)
    const r = await tpl(id)
    expect(r?.pinned).toBe(true)
    expect(r?.isTemplate).toBe(true)
  })
})

describe('updatePins — только свои списки', () => {
  it('в набор попал чужой список — он НЕ закрепляется (scope по ownerId)', async () => {
    const mine = await seedList(ownerId)
    const foreign = await seedList(otherId)
    h.session = { userId: ownerId, handle: 'bowner' }
    await updatePins([mine, foreign])
    expect((await tpl(mine))?.pinned).toBe(true)
    expect((await tpl(foreign))?.pinned).toBe(false) // чужой не тронут
  })
})

describe('toggleStar — гейт видимости на write', () => {
  it('нельзя звездить приватный чужой список (нет строки star)', async () => {
    const id = await seedList(ownerId, { visibility: 'private' })
    h.session = { userId: otherId, handle: 'bother' }
    await toggleStar(id)
    expect(await isStarred(otherId, id)).toBe(false)
  })

  it('публичный можно звездить и снимать звезду (toggle)', async () => {
    const id = await seedList(ownerId, { visibility: 'public', status: 'published', moderation: 'active' })
    h.session = { userId: otherId, handle: 'bother' }
    await toggleStar(id)
    expect(await isStarred(otherId, id)).toBe(true)
    await toggleStar(id)
    expect(await isStarred(otherId, id)).toBe(false)
  })
})
