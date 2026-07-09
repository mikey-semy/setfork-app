import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Мокаем ТОЛЬКО границу Next-рантайма: кто «текущий пользователь» и заглушки
// redirect/revalidatePath. БД, проверки владения и анти-отмывки — настоящие.
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
    const e = new Error('REDIRECT') as Error & { url: string }
    e.url = url
    throw e
  },
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))
// Аудит и переиндексация пишут в БД/очередь — для этих тестов не важны, глушим.
vi.mock('@/shared/audit', () => ({ recordAudit: async () => {} }))

const { db, templates, users } = await import('@/shared/db')
const { setListVisibility, deleteListAction } = await import('@/features/library/actions')

let ownerId = ''
let otherId = ''

async function seedList(over: Partial<typeof templates.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(templates)
    .values({ ownerId, slug: `l-${Math.random().toString(36).slice(2)}`, title: { en: 'L' }, ...over })
    .returning({ id: templates.id })
  return row.id
}
const modOf = async (id: string) =>
  (await db.query.templates.findFirst({ where: (t, { eq }) => eq(t.id, id) }))?.moderation
const visOf = async (id: string) =>
  (await db.query.templates.findFirst({ where: (t, { eq }) => eq(t.id, id) }))?.visibility
const exists = async (id: string) => !!(await db.query.templates.findFirst({ where: (t, { eq }) => eq(t.id, id) }))

beforeEach(async () => {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
  const [o] = await db.insert(users).values({ handle: 'owner1' }).returning({ id: users.id })
  const [x] = await db.insert(users).values({ handle: 'other1' }).returning({ id: users.id })
  ownerId = o.id
  otherId = x.id
})
afterAll(async () => {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
})

describe('setListVisibility — владение + анти-отмывка', () => {
  it('не-владелец не может менять видимость чужого списка', async () => {
    const id = await seedList({ visibility: 'public' })
    h.session = { userId: otherId, handle: 'other1' }
    await setListVisibility(id, 'private')
    expect(await visOf(id)).toBe('public') // не изменилось
  })

  it('владелец переключает public → private', async () => {
    const id = await seedList({ visibility: 'public' })
    h.session = { userId: ownerId, handle: 'owner1' }
    await setListVisibility(id, 'private')
    expect(await visOf(id)).toBe('private')
  })

  it('flagged НЕ отмывается переключением в private (остаётся flagged)', async () => {
    const id = await seedList({ visibility: 'public', moderation: 'flagged' })
    h.session = { userId: ownerId, handle: 'owner1' }
    await setListVisibility(id, 'private')
    expect(await modOf(id)).toBe('flagged') // ключевой инвариант анти-отмывки
    expect(await visOf(id)).toBe('private')
  })

  it('pending при уходе в private сбрасывается в active (гейт не нужен приватному)', async () => {
    const id = await seedList({ visibility: 'public', moderation: 'pending' })
    h.session = { userId: ownerId, handle: 'owner1' }
    await setListVisibility(id, 'private')
    expect(await modOf(id)).toBe('active')
  })
})

describe('deleteListAction — владение + анти-отмывка', () => {
  it('не-владелец не может удалить чужой список', async () => {
    const id = await seedList()
    h.session = { userId: otherId, handle: 'other1' }
    await deleteListAction(id).catch(() => {}) // может redirect'нуть — глушим
    expect(await exists(id)).toBe(true)
  })

  it('владелец НЕ может hard-delete снятый модерацией список (redirect на locked)', async () => {
    const id = await seedList({ moderation: 'flagged' })
    h.session = { userId: ownerId, handle: 'owner1' }
    const err = await deleteListAction(id).catch((e) => e)
    expect((err as { url?: string }).url).toContain('locked_moderation')
    expect(await exists(id)).toBe(true) // отпечаток сохранён — повторную заливку не отмыть
  })

  it('владелец удаляет обычный (active) список', async () => {
    const id = await seedList({ moderation: 'active' })
    h.session = { userId: ownerId, handle: 'owner1' }
    await deleteListAction(id).catch(() => {}) // успех тоже завершается redirect'ом
    expect(await exists(id)).toBe(false)
  })
})
