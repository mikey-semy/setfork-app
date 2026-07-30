import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

// Линза 02 (безопасность), пункт 1 «повышение прав»: КАЖДЫЙ путь присвоения ника
// отдельным прогоном. Регистрация и смена ника проверяют isAdminHandle/RESERVED
// (#476, #529), а upsertGithubUser писал gh.login в handle СЫРЫМ — свободный
// админ-ник занимался входом через GitHub, занятый обходился регистром букв.
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

describe('GitHub-логин не даёт занять чужой ник', () => {
  it('свободный админ-ник НЕ занимается входом через GitHub', async () => {
    await upsertGithubUser({ id: 1001, login: 'bigboss', name: null, avatar_url: null })
    const got = await isAdminInDb(1001)
    expect(got.handle).not.toBe('bigboss')
    expect(got.admin).toBe(false)
  })

  it('админ-ник ЗАНЯТ владельцем → вариант регистра больше не проходит', async () => {
    await db.insert(users).values({ handle: 'mikey-semy', name: 'Владелец' })
    await upsertGithubUser({ id: 1002, login: 'MIKEY-SEMY', name: null, avatar_url: null })
    const got = await isAdminInDb(1002)
    expect(got.handle.toLowerCase()).not.toBe('mikey-semy')
    expect(got.admin).toBe(false)
    // Строка владельца цела: вошедший получил СВОЙ ник, а не чужой.
    const owners = await db.select({ id: users.id }).from(users).where(eq(users.handle, 'mikey-semy'))
    expect(owners).toHaveLength(1)
  })

  it('переименование GitHub-аккаунта не меняет ник и не поднимает права', async () => {
    await upsertGithubUser({ id: 1003, login: 'normal-guy', name: null, avatar_url: null })
    expect(await isAdminInDb(1003)).toEqual({ handle: 'normal-guy', admin: false })
    await upsertGithubUser({ id: 1003, login: 'bigboss', name: null, avatar_url: null })
    expect(await isAdminInDb(1003)).toEqual({ handle: 'normal-guy', admin: false })
  })

  it('служебные ники (ghost, gardener, demo) тем же путём не занимаются', async () => {
    await upsertGithubUser({ id: 1004, login: 'ghost', name: null, avatar_url: null })
    await upsertGithubUser({ id: 1005, login: 'gardener', name: null, avatar_url: null })
    await upsertGithubUser({ id: 1006, login: 'demo', name: null, avatar_url: null })
    const handles = (await db.select({ handle: users.handle }).from(users)).map((r) => r.handle)
    for (const reserved of ['ghost', 'gardener', 'demo']) expect(handles).not.toContain(reserved)
  })

  it('форма ника соблюдается: логин из 39 заглавных букв заезжает нормализованным', async () => {
    await upsertGithubUser({ id: 1007, login: 'A'.repeat(39), name: null, avatar_url: null })
    const [row] = await db.select({ handle: users.handle }).from(users).where(eq(users.githubId, 1007)).limit(1)
    expect(isHandleShapeValid(row.handle)).toBe(true)
  })

  it('обычный вход не сломан: свободный логин достаётся как есть, повтор входа не плодит строк', async () => {
    const first = await upsertGithubUser({ id: 1008, login: 'octocat', name: 'Octo', avatar_url: null })
    expect(first.handle).toBe('octocat')
    const again = await upsertGithubUser({ id: 1008, login: 'octocat', name: 'Octo', avatar_url: null })
    expect(again.userId).toBe(first.userId)
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.githubId, 1008))
    expect(rows).toHaveLength(1)
  })

  it('те же правила на путях регистрации и смены ника (контроль)', async () => {
    await db.insert(users).values({ handle: 'mikey-semy' })
    expect(isHandleShapeValid('bigboss')).toBe(false) // регистрация (#529)
    expect(await handleTaken(normalizeHandle('MIKEY-SEMY'))).toBe(true) // смена ника
    expect(await handleTaken('MIKEY-SEMY')).toBe(true) // и без нормализации на входе
    expect(await handleTaken('ghost')).toBe(true)
    expect(await handleTaken('gardener')).toBe(true)
  })
})
