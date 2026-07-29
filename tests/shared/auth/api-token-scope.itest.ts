import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Право записи по API-токену — FAIL-CLOSED.
 *
 * Колонка `scope` — свободный текст, и прежнее правило «всё, что не read → write»
 * означало, что опечатка, пустая строка или значение из будущей версии молча
 * выдавали полный доступ к чужим данным через MCP. Неизвестное значение обязано
 * ОТНИМАТЬ права, а не добавлять.
 *
 * Тест интеграционный намеренно: проверять надо ровно то, что происходит с РЕАЛЬНОЙ
 * строкой в таблице, а не с аргументом функции.
 */
const { apiTokens, db, users } = await import('@/shared/db')
const { hashToken, newToken, verifyApiToken } = await import('@/shared/auth/api-token')

let userId = ''

/** Кладём токен с ПРОИЗВОЛЬНЫМ значением scope — так, как оно может оказаться в БД. */
async function tokenWithScope(scope: string): Promise<string> {
  const { token, hash, prefix } = newToken()
  await db.insert(apiTokens).values({ userId, name: `t-${scope || 'empty'}`, tokenHash: hash, prefix, scope })
  return token
}

beforeAll(async () => {
  await db.execute(sql`truncate table ${users} restart identity cascade`)
  const [u] = await db.insert(users).values({ handle: 'tok-owner' }).returning({ id: users.id })
  userId = u.id
})

describe('scope токена', () => {
  it('точное write даёт запись', async () => {
    expect(await verifyApiToken(await tokenWithScope('write'))).toMatchObject({ scope: 'write' })
  })

  it('точное read даёт только чтение', async () => {
    expect(await verifyApiToken(await tokenWithScope('read'))).toMatchObject({ scope: 'read' })
  })

  it('опечатка не даёт записи — раньше давала', async () => {
    expect(await verifyApiToken(await tokenWithScope('wrtie'))).toMatchObject({ scope: 'read' })
  })

  it('пустая строка не даёт записи', async () => {
    expect(await verifyApiToken(await tokenWithScope(''))).toMatchObject({ scope: 'read' })
  })

  it('значение из будущей версии («admin») не даёт записи', async () => {
    expect(await verifyApiToken(await tokenWithScope('admin'))).toMatchObject({ scope: 'read' })
  })

  it('регистр значения не расширяет права', async () => {
    expect(await verifyApiToken(await tokenWithScope('WRITE'))).toMatchObject({ scope: 'read' })
  })

  it('чужой токен не проходит вовсе', async () => {
    await tokenWithScope('write')
    expect(await verifyApiToken('sf_' + 'x'.repeat(32))).toBeNull()
    expect(hashToken('sf_a')).not.toBe(hashToken('sf_b'))
  })
})
