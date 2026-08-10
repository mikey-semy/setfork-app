import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// Privesc через самоназначаемый ник закрывали в #476, но только на пути СМЕНЫ ника
// (handleTaken/isHandleShapeValid). Регистрация по email+паролю проверяла лишь форму и
// RESERVED_HANDLES — то есть свободный ник из ADMIN_HANDLES можно было занять при регистрации
// и получить права админа: getAdmin() считает админом по ТЕКУЩЕМУ нику из БД.
// Окно возникает при каждом расширении ADMIN_HANDLES новым ником и на любом свежем инстансе.
// Тест ходит в реальную БД: проверяются и предикаты, и фактическая строка в users.

process.env.ADMIN_HANDLES = 'bigboss,secondadmin'

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`)
  },
}))
vi.mock('@/shared/auth/session', () => ({ startSession: async () => {}, getSession: async () => null }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'ru' }))
vi.mock('@/shared/rate-limit', () => ({ rateLimit: async () => ({ ok: true, remaining: 100 }) }))
vi.mock('@/shared/auth/app-origin', () => ({ clientIpFromHeaders: async () => '127.0.0.1' }))
vi.mock('@/shared/media', () => ({ avatarSrc: async () => null }))

const { db, users } = await import('@/shared/db')
const { registerWithPassword } = await import('@/features/auth/actions')
const { handleTaken, isHandleShapeValid } = await import('@/shared/auth/handle')
const { isAdminHandle } = await import('@/shared/auth/admin-handle')

const fd = (o: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.append(k, v)
  return f
}
/** Регистрация: либо {error}, либо 'redirect' (успех уводит на главную). */
async function register(handle: string, email: string): Promise<{ error?: string } | 'redirect'> {
  try {
    return (await registerWithPassword(null, fd({ email, handle, password: 'correct-horse' }))) ?? {}
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('REDIRECT:')) return 'redirect'
    throw e
  }
}
const rowOf = async (handle: string) => db.query.users.findFirst({ where: (u, { eq }) => eq(u.handle, handle) })

beforeAll(async () => {
  await resetTables(sql`${users}`)
})
afterAll(async () => {
  await resetTables(sql`${users}`)
})

describe('ник администратора нельзя занять НИ ОДНИМ путём', () => {
  it('путь смены ника: предикаты формы и занятости отвергают админ-ник', async () => {
    expect(isAdminHandle('bigboss')).toBe(true)
    expect(isHandleShapeValid('bigboss')).toBe(false)
    expect(await handleTaken('secondadmin')).toBe(true)
  })

  it('путь регистрации: свободный админ-ник занять нельзя', async () => {
    const res = await register('secondadmin', 'attacker@example.com')
    expect(res).toEqual({ error: expect.any(String) })
    expect(await rowOf('secondadmin')).toBeUndefined()
  })

  it('путь регистрации: зарезервированное слово тоже отвергается', async () => {
    const res = await register('admin', 'x@example.com')
    expect(res).toEqual({ error: expect.any(String) })
    expect(await rowOf('admin')).toBeUndefined()
  })

  it('обычный ник регистрируется как прежде', async () => {
    expect(await register('regularperson', 'ok@example.com')).toBe('redirect')
    const row = await rowOf('regularperson')
    expect(row?.email).toBe('ok@example.com')
    expect(isAdminHandle(row!.handle)).toBe(false)
  })

  it('без ADMIN_HANDLES проверка не строже прежней — ники персон смока проходят', async () => {
    const saved = process.env.ADMIN_HANDLES
    process.env.ADMIN_HANDLES = '' // как в smoke.yml: переменная не задана
    try {
      expect(await register('sim-sms4c1dt6-pavel-runs-0', 'sim@example.com')).toBe('redirect')
      expect(await rowOf('sim-sms4c1dt6-pavel-runs-0')).toBeDefined()
    } finally {
      process.env.ADMIN_HANDLES = saved
    }
  })
})
