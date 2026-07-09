import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// MCP-инструменты берут userId прямо из токена (не cookie-сессия) → тестируются без
// моков, чистой БД. Сквозной поток create→get→update + проверки владения/видимости:
// список создаётся ЧЕРНОВИКОМ (виден только владельцу), обновлять может только владелец.
const { db, templates, users } = await import('@/shared/db')
const { mcpCreateList, mcpGetList, mcpUpdateList } = await import('@/features/mcp/tools')

let ownerId = ''
let otherId = ''
const refSlug = (r: string) => r.split('/')[1]

beforeAll(async () => {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
  const [o] = await db.insert(users).values({ handle: 'mowner' }).returning({ id: users.id })
  const [x] = await db.insert(users).values({ handle: 'mother' }).returning({ id: users.id })
  ownerId = o.id
  otherId = x.id
})
afterAll(async () => {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
})

describe('mcp create/get/update — владение и видимость по userId токена', () => {
  it('валидация входа: пустой title / нет пунктов → ошибка, список не создан', async () => {
    expect(await mcpCreateList(ownerId, { title: '', items: [{ title: 'x' }] })).toMatchObject({ error: expect.stringContaining('title') })
    expect(await mcpCreateList(ownerId, { title: 'T', items: [] })).toMatchObject({ error: expect.stringContaining('item') })
  })

  it('сквозной поток: create (draft) → owner видит, чужой нет → update только владельцем', async () => {
    // 1. Создание — всегда черновик
    const created = await mcpCreateList(ownerId, { title: 'Deploy Guide', items: [{ title: 'install' }] })
    expect(created).toMatchObject({ status: 'draft' })
    const slug = refSlug((created as { ref: string }).ref)
    const row = await db.query.templates.findFirst({ where: (t, { eq }) => eq(t.slug, slug) })
    expect(row?.ownerId).toBe(ownerId)
    expect(row?.status).toBe('draft')

    // 2. Черновик виден владельцу, НЕ виден чужому (gate status='draft')
    expect(await mcpGetList(ownerId, 'mowner', slug)).not.toBeNull()
    expect(await mcpGetList(otherId, 'mowner', slug)).toBeNull()

    // 3. Обновлять может только владелец
    const forbidden = await mcpUpdateList(otherId, 'mowner', slug, { items: [{ title: 'hax' }] })
    expect(forbidden).toMatchObject({ error: expect.stringContaining('forbidden') })

    const ok = await mcpUpdateList(ownerId, 'mowner', slug, { items: [{ title: 'install' }, { title: 'configure' }] })
    expect(ok).toMatchObject({ status: 'draft' }) // черновик правится на месте
    expect('error' in ok).toBe(false)
  })

  it('update несуществующего списка → not found', async () => {
    expect(await mcpUpdateList(ownerId, 'mowner', 'no-such-slug', { items: [{ title: 'x' }] })).toMatchObject({ error: expect.stringContaining('not found') })
  })
})
