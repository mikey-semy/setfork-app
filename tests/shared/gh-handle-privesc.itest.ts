import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

// Линза 02 (безопасность), пункт 1 «повышение прав»: КАЖДЫЙ путь присвоения ника
// отдельным прогоном. Регистрация и смена ника проверяют isAdminHandle/RESERVED
// (#476, #529), а вот upsertGithubUser пишет gh.login в handle СЫРЫМ.
// Проверяем настоящий upsertGithubUser на реальной БД.

const { db, users } = await import('@/shared/db')
const { upsertGithubUser } = await import('@/shared/auth/users')
const { isAdminHandle } = await import('@/shared/auth/admin-handle')
const { isHandleShapeValid, normalizeHandle, handleTaken } = await import('@/shared/auth/handle')

const OLD_ADMINS = process.env.ADMIN_HANDLES

async function isAdminInDb(githubId: number): Promise<{ handle: string; admin: boolean }> {
  const [row] = await db.select({ handle: users.handle }).from(users).where(eq(users.githubId, githubId)).limit(1)
  // Ровно то, что делает getAdmin(): текущий ник из БД по userId → isAdminHandle.
  return { handle: row?.handle ?? '', admin: isAdminHandle(row?.handle) }
}

beforeEach(async () => {
  await db.execute(sql`truncate table ${users} restart identity cascade`)
  process.env.ADMIN_HANDLES = 'bigboss,mikey-semy'
})

afterAll(() => {
  if (OLD_ADMINS === undefined) delete process.env.ADMIN_HANDLES
  else process.env.ADMIN_HANDLES = OLD_ADMINS
})

describe('privesc через GitHub-логин', () => {
  it('свободный админ-ник занимается входом через GitHub', async () => {
    await upsertGithubUser({ id: 1001, login: 'bigboss', name: 'Attacker', avatar_url: null })
    expect(await isAdminInDb(1001)).toEqual({ handle: 'bigboss', admin: true })
  })

  it('админ-ник ЗАНЯТ владельцем → регистр букв обходит уникальность и всё равно даёт админа', async () => {
    await db.insert(users).values({ handle: 'mikey-semy', name: 'Владелец' })
    await upsertGithubUser({ id: 1002, login: 'MIKEY-SEMY', name: 'Attacker', avatar_url: null })
    const got = await isAdminInDb(1002)
    expect(got.handle).toBe('MIKEY-SEMY')
    expect(got.admin).toBe(true) // ← privesc при уже занятом нике
  })

  it('переименование GitHub-аккаунта поднимает существующего юзера до админа при следующем входе', async () => {
    await upsertGithubUser({ id: 1003, login: 'normal-guy', name: null, avatar_url: null })
    expect((await isAdminInDb(1003)).admin).toBe(false)
    await upsertGithubUser({ id: 1003, login: 'bigboss', name: null, avatar_url: null })
    expect((await isAdminInDb(1003)).admin).toBe(true)
  })

  it('зарезервированные служебные ники (ghost, gardener, demo) занимаются тем же путём', async () => {
    await upsertGithubUser({ id: 1004, login: 'ghost', name: null, avatar_url: null })
    await upsertGithubUser({ id: 1005, login: 'gardener', name: null, avatar_url: null })
    await upsertGithubUser({ id: 1006, login: 'demo', name: null, avatar_url: null })
    const handles = (await db.select({ handle: users.handle }).from(users)).map((r) => r.handle).sort()
    expect(handles).toEqual(['demo', 'gardener', 'ghost'])
  })

  it('форма ника вообще не проверяется: длина >30 и заглавные проходят', async () => {
    await upsertGithubUser({ id: 1007, login: 'A'.repeat(39), name: null, avatar_url: null })
    const [row] = await db.select({ handle: users.handle }).from(users).where(eq(users.githubId, 1007)).limit(1)
    expect(row.handle.length).toBe(39)
    expect(isHandleShapeValid(row.handle)).toBe(false)
  })

  it('для сравнения: тот же ввод на путях регистрации и смены ника отвергается', async () => {
    await db.insert(users).values({ handle: 'mikey-semy' })
    expect(isHandleShapeValid('bigboss')).toBe(false) // регистрация (#529)
    expect(await handleTaken(normalizeHandle('MIKEY-SEMY'))).toBe(true) // смена ника
    expect(await handleTaken('ghost')).toBe(true)
  })
})
