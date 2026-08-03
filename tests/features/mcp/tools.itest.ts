import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { McpItemInput } from '@/features/mcp/tools'

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

  // Ссылки: get_list их отдавал, а положить было нечем — записать через API стало
  // возможно только вместе с типом 'file' и полем refs у шага.
  it('ссылки едут в обе стороны: refs шага и file-блок сохраняются и читаются', async () => {
    const created = await mcpCreateList(ownerId, {
      title: 'Links',
      items: [
        { title: 'read the docs', refs: [{ label: 'MDN', url: 'https://developer.mozilla.org' }, { label: 'no-url' }] },
        { type: 'file', url: 'https://example.com/spec.pdf', fileName: 'spec.pdf' },
      ],
    })
    const slug = refSlug((created as { ref: string }).ref)
    const list = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { steps: McpItemInput[] }
    expect(list.steps.find((b) => b.type === 'step')?.refs).toEqual([
      { label: 'MDN', url: 'https://developer.mozilla.org' },
      { label: 'no-url', url: undefined },
    ])
    expect(list.steps.find((b) => b.type === 'file')).toMatchObject({ url: 'https://example.com/spec.pdf', name: 'spec.pdf' })
  })

  // Круг агента: прочитал список и отдал ЕГО ЖЕ обратно в update_list. Вход обязан
  // понимать ту форму, которую отдаёт чтение, иначе круг молча теряет поля.
  it('get → update тем же телом ничего не теряет (file.name, image.ref)', async () => {
    const created = await mcpCreateList(ownerId, {
      title: 'Round trip',
      items: [
        { title: 'step one', refs: [{ label: 'docs', url: 'https://example.com/docs' }] },
        { type: 'file', url: 'https://example.com/spec.pdf', fileName: 'spec.pdf' },
        { type: 'image', imageRef: 'uploads/pic.webp', caption: 'схема' },
      ],
    })
    const slug = refSlug((created as { ref: string }).ref)
    const read = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { steps: McpItemInput[] }
    // Блоки чтения уходят в запись БЕЗ переименования полей.
    const updated = await mcpUpdateList(ownerId, 'mowner', slug, { items: read.steps })
    expect('error' in updated).toBe(false)
    const again = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { steps: McpItemInput[] }
    expect(again.steps.find((b) => b.type === 'file')).toMatchObject({ url: 'https://example.com/spec.pdf', name: 'spec.pdf' })
    expect(again.steps.find((b) => b.type === 'image')).toMatchObject({ ref: 'uploads/pic.webp', caption: 'схема' })
    expect(again.steps.find((b) => b.type === 'step')?.refs).toEqual([{ label: 'docs', url: 'https://example.com/docs' }])
  })
})
