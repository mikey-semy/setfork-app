import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ПАРОЛЬ В НАСТРОЙКАХ — ЗАПАСНОЙ ВЫХОД, А НЕ УДОБСТВО.
 *
 * Вошедший через внешнего провайдера пароля не имеет вовсе. Пропадёт тот аккаунт —
 * пропадёт доступ: восстановление по почте меняет пароль, которого никогда не было, а
 * войти, чтобы его завести, уже нечем. Владелец назвал это прямо (02.09.2026): «может
 * случиться так, что аккаунта в GitHub или Telegram может не стать. Что тогда?»
 */
const session = vi.hoisted(() => ({ userId: '', handle: 'pw-user', sid: '' }))
vi.mock('@/shared/auth/session', () => ({
  requireSession: async () => ({ userId: session.userId, handle: session.handle, sid: session.sid }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/shared/auth/app-origin', () => ({ clientIpFromHeaders: async () => '127.0.0.1' }))

const { db, sessions, users } = await import('@/shared/db')
const { hashPassword, verifyPassword } = await import('@/shared/auth/password')
const { setPassword } = await import('@/features/settings/password-actions')

const form = (fields: Record<string, string>): FormData => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}
const hashOf = async (): Promise<string | null> =>
  (await db.select({ h: users.passwordHash }).from(users).where(eq(users.id, session.userId)).limit(1))[0].h

const seed = async (passwordHash: string | null): Promise<void> => {
  await resetTables([users])
  const [u] = await db.insert(users).values({ handle: session.handle, passwordHash }).returning({ id: users.id })
  const rows = await db
    .insert(sessions)
    .values([
      { userId: u.id, userAgent: 'этот' },
      { userId: u.id, userAgent: 'ноутбук' },
      { userId: u.id, userAgent: 'телефон' },
    ])
    .returning({ id: sessions.id })
  Object.assign(session, { userId: u.id, sid: rows[0].id })
}

describe('пароля не было', () => {
  beforeEach(() => seed(null))

  it('задаётся без подтверждения старым: подтверждать нечем', async () => {
    expect(await setPassword(null, form({ password: 'zapasnoy-vyhod' }))).toEqual({ ok: true })
    expect(verifyPassword('zapasnoy-vyhod', await hashOf())).toBe(true)
  })

  it('короткий не принимается — то же правило, что на регистрации', async () => {
    expect(await setPassword(null, form({ password: 'korotky' }))).toEqual({ error: 'passwordShort' })
    expect(await hashOf(), 'при отказе пароль не должен появиться').toBeNull()
  })
})

describe('пароль уже есть', () => {
  beforeEach(() => seed(hashPassword('staryy-parol')))

  it('меняется со старым на руках', async () => {
    expect(await setPassword(null, form({ current: 'staryy-parol', password: 'novyy-parol-tut' }))).toEqual({ ok: true })
    expect(verifyPassword('novyy-parol-tut', await hashOf())).toBe(true)
  })

  it('⚠️ без старого не меняется: иначе угнавший сессию запирает хозяина снаружи', async () => {
    expect(await setPassword(null, form({ current: 'ne-tot', password: 'novyy-parol-tut' }))).toEqual({
      error: 'auth.password.wrongCurrent',
    })
    expect(verifyPassword('staryy-parol', await hashOf()), 'старый пароль обязан уцелеть').toBe(true)
  })

  it('после смены остаётся только текущее устройство', async () => {
    // Смена пароля — обычная реакция на «кажется, меня взломали»: чужая сессия обязана
    // умереть. Своя при этом живёт, иначе человек решит, что смена не удалась.
    await setPassword(null, form({ current: 'staryy-parol', password: 'novyy-parol-tut' }))
    const left = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, session.userId))
    expect(left.map((r) => r.id)).toEqual([session.sid])
  })
})
