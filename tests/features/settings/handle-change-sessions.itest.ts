import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * СМЕНА НИКА отзывает остальные сессии.
 *
 * Ник лежит в cookie сессии, и по нему считаются права администратора
 * (ADMIN_HANDLES) и ключи квот. Сессии, открытые ДО переименования, продолжали бы
 * носить старый ник: на другом устройстве человек оставался бы прежним собой — с
 * прежними правами и прежними счётчиками.
 *
 * Текущую сессию не трогаем: разлогинивать того, кто сам только что переименовался,
 * незачем — ей просто обновляется cookie.
 */
const session = vi.hoisted(() => ({ userId: '', handle: '', sid: '' }))
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => ({ userId: session.userId, handle: session.handle, sid: session.sid }),
  refreshSessionCookie: vi.fn(async () => {}),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('REDIRECT')
  },
}))

const { db, sessions, users } = await import('@/shared/db')
const { changeHandle } = await import('@/features/settings/actions')

beforeEach(async () => {
  await db.execute(sql`truncate table ${users} restart identity cascade`)
  const [u] = await db.insert(users).values({ handle: 'old-name' }).returning({ id: users.id })
  const rows = await db
    .insert(sessions)
    .values([
      { userId: u.id, userAgent: 'этот' },
      { userId: u.id, userAgent: 'ноутбук' },
      { userId: u.id, userAgent: 'телефон' },
    ])
    .returning({ id: sessions.id })
  Object.assign(session, { userId: u.id, handle: 'old-name', sid: rows[0].id })
})

const change = async (to: string) => {
  const fd = new FormData()
  fd.set('handle', to)
  try {
    await changeHandle(null, fd)
  } catch (e) {
    if ((e as Error).message !== 'REDIRECT') throw e // успех оформлен редиректом
  }
}

describe('смена ника и сессии', () => {
  it('чужие устройства разлогиниваются, текущее — нет', async () => {
    await change('new-name')
    const left = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, session.userId))
    expect(left).toHaveLength(1)
    expect(left[0].id, 'осталась ровно текущая сессия').toBe(session.sid)
  })

  it('ник в базе действительно сменился', async () => {
    await change('new-name')
    const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, session.userId))
    expect(u.handle).toBe('new-name')
  })
})
