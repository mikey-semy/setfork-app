import { sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// Реестр источников — единственная дверь, через которую чужой материал попадает в корпус.
// Проверяем на реальной БД: fail-closed по лицензии, обязательность атрибуции там, где её
// требует лицензия, и что повторная регистрация ОБНОВЛЯЕТ запись, а не заводит вторую с
// другой лицензией (иначе «какая настоящая» решать нечем).
// Реестр источников теперь только для администратора: юридический вердикт даёт тот,
// кто за него отвечает. Ник владельца объявляем админским ДО импорта модулей.
process.env.ADMIN_HANDLES = 'src-owner'

const { agentActions, db, knowledgeSources, users } = await import('@/shared/db')
const { mcpListSources, mcpRegisterSource } = await import('@/features/mcp/tools')

let userId = ''

beforeAll(async () => {
  await resetTables([agentActions, knowledgeSources, users])
  const [u] = await db.insert(users).values({ handle: 'src-owner' }).returning({ id: users.id })
  userId = u.id
})

beforeEach(async () => {
  await db.delete(knowledgeSources)
  await db.delete(agentActions)
})

describe('регистрация источника', () => {
  it('без лицензии — отказ, запись не появляется', async () => {
    expect(await mcpRegisterSource(userId, { url: 'https://example.com/a', license: '' })).toMatchObject({ error: expect.stringContaining('не указана') })
    expect((await mcpListSources()).sources).toBe(0)
  })

  it('NC-вариант — отказ (он запрещает ровно то, ради чего берём)', async () => {
    expect(await mcpRegisterSource(userId, { url: 'https://example.com/a', license: 'CC BY-NC 4.0', attribution: 'Автор' })).toMatchObject({
      error: expect.stringContaining('не в списке разрешённых'),
    })
  })

  it('CC-BY без атрибуции — отказ; с атрибуцией — принимается и нормализуется', async () => {
    expect(await mcpRegisterSource(userId, { url: 'https://example.com/a', license: 'CC BY 4.0' })).toMatchObject({ error: expect.stringContaining('авторства') })
    const ok = await mcpRegisterSource(userId, { url: 'https://example.com/a', license: 'cc-by-4.0', attribution: 'Иван Петров', title: 'Статья' })
    expect(ok).toMatchObject({ license: 'CC-BY' })
    expect((ok as { attribution: string }).attribution).toContain('Иван Петров')
  })

  it('не-http адрес отклоняется до всякой лицензии', async () => {
    expect(await mcpRegisterSource(userId, { url: 'ftp://example.com/a', license: 'CC0' })).toMatchObject({ error: expect.stringContaining('http') })
  })

  it('повторная регистрация ОБНОВЛЯЕТ запись, а не плодит вторую', async () => {
    await mcpRegisterSource(userId, { url: 'https://example.com/b', license: 'CC0', title: 'Было' })
    await mcpRegisterSource(userId, { url: 'https://example.com/b', license: 'CC BY-SA 4.0', attribution: 'Коллектив', title: 'Стало' })
    const list = await mcpListSources()
    expect(list.sources).toBe(1)
    expect(list.allowed[0]).toMatchObject({ license: 'CC-BY-SA', title: 'Стало', attribution: 'Коллектив' })
  })

  it('регистрация пишется в журнал как сделанная человеком через ассистента', async () => {
    await mcpRegisterSource(userId, { url: 'https://example.com/c', license: 'CC0' })
    const [row] = await db.select().from(agentActions)
    expect(row).toMatchObject({ loop: 'mcp', action: 'source.register', principalMode: 'on_behalf_of', resultStatus: 'ok' })
  })

  it('отказ записи в журнал не оставляет — регистрации не было', async () => {
    await mcpRegisterSource(userId, { url: 'https://example.com/d', license: 'проприетарная' })
    expect(await db.select().from(agentActions)).toHaveLength(0)
  })
})

describe('кто вправе пополнять реестр', () => {
  it('обычный пользователь — отказ: это юридический вердикт, а не рядовая запись', async () => {
    const [u] = await db.insert(users).values({ handle: 'src-stranger' }).returning({ id: users.id })
    expect(await mcpRegisterSource(u.id, { url: 'https://example.com/z', license: 'CC0' })).toMatchObject({
      error: expect.stringContaining('administrator'),
    })
    // Записи не появилось — отказ настоящий, а не косметический.
    expect((await mcpListSources()).sources).toBe(0)
  })
})
