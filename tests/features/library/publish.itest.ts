import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// publishList (draft → published) против реального Postgres: только владелец, только
// черновик; публичный при публикации уходит в гейт (pending), приватный — нет.
// Мокаем границу Next (сессия, redirect/revalidate) и ключ ИИ (иначе гейт выключен).
const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string } }))
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => {
    if (!h.session) throw new Error('no session')
    return h.session
  },
  getSession: async () => h.session,
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error('REDIRECT'), { url })
  },
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))
vi.mock('@/shared/settings/ai', () => ({ getApiKey: async () => 'test-key', getAiSettings: async () => ({ enabled: true }) }))

const { db, templates, users } = await import('@/shared/db')
const { publishList } = await import('@/features/library/actions')

let ownerId = ''
let otherId = ''

async function seedDraft(over: Partial<typeof templates.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(templates)
    .values({ ownerId, slug: `p-${Math.random().toString(36).slice(2)}`, title: { en: 'P' }, status: 'draft', ...over })
    .returning({ id: templates.id })
  return row.id
}
const row = async (id: string) => db.query.templates.findFirst({ where: (t, { eq }) => eq(t.id, id) })

beforeEach(async () => {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
  const [o] = await db.insert(users).values({ handle: 'powner' }).returning({ id: users.id })
  const [x] = await db.insert(users).values({ handle: 'pother' }).returning({ id: users.id })
  ownerId = o.id
  otherId = x.id
})
afterAll(async () => {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
})

describe('publishList — владение + гейт', () => {
  it('не-владелец не публикует чужой черновик', async () => {
    const id = await seedDraft({ visibility: 'public' })
    h.session = { userId: otherId, handle: 'pother' }
    await publishList(id).catch(() => {}) // не-владелец → ранний return, redirect не бросается
    expect((await row(id))?.status).toBe('draft')
  })

  it('владелец публикует ПУБЛИЧНЫЙ черновик → published + гейт (pending)', async () => {
    const id = await seedDraft({ visibility: 'public', moderation: 'active' })
    h.session = { userId: ownerId, handle: 'powner' }
    await publishList(id).catch(() => {}) // успех завершается redirect'ом
    const r = await row(id)
    expect(r?.status).toBe('published')
    expect(r?.moderation).toBe('pending') // публичная публикация → гейт
  })

  it('владелец публикует ПРИВАТНЫЙ черновик → published, гейт НЕ трогает (active)', async () => {
    const id = await seedDraft({ visibility: 'private', moderation: 'active' })
    h.session = { userId: ownerId, handle: 'powner' }
    await publishList(id).catch(() => {})
    const r = await row(id)
    expect(r?.status).toBe('published')
    expect(r?.moderation).toBe('active') // приватный не гейтится
  })

  it('уже опубликованный (не draft) → no-op', async () => {
    const id = await seedDraft({ visibility: 'public', status: 'published', moderation: 'active' })
    h.session = { userId: ownerId, handle: 'powner' }
    await publishList(id).catch(() => {}) // status !== draft → ранний return
    expect((await row(id))?.moderation).toBe('active') // не ушёл в pending
  })
})
