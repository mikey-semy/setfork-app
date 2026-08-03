import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { McpItemInput } from '@/features/mcp/tools'

// MCP-инструменты берут userId прямо из токена (не cookie-сессия) → тестируются без
// моков, чистой БД. Сквозной поток create→get→update + проверки владения/видимости:
// список создаётся ЧЕРНОВИКОМ (виден только владельцу), обновлять может только владелец.
const { db, templates, users } = await import('@/shared/db')
const { mcpCreateList, mcpGetList, mcpPatchList, mcpUpdateList } = await import('@/features/mcp/tools')

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

  // Идентичность блока сквозь версии: на ней держатся комментарии к пункту, голоса
  // опроса, попытки теста и merge по id. MCP-путь собирал блоки заново — каждая
  // запись через API обнуляла её, и всё привязанное осиротевало.
  it('круг сохраняет идентичность: bid блоков, id вариантов, needsHuman и картинку шага', async () => {
    const created = await mcpCreateList(ownerId, {
      title: 'Identity',
      items: [
        { title: 'ask a local', needsHuman: true, needsHumanAsk: 'сколько стоит у вас?', imageRef: 'uploads/shot.webp' },
        { type: 'poll', question: 'чем ставить?', options: [{ text: 'winget' }, { text: 'вручную' }] },
        { type: 'text', text: 'врезка' },
      ],
    })
    const slug = refSlug((created as { ref: string }).ref)
    const before = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { steps: McpItemInput[] }
    // Идентичность видна снаружи — иначе патчить блок нечем.
    expect(before.steps.every((b) => !!b.bid)).toBe(true)
    const pollBefore = before.steps.find((b) => b.type === 'poll')
    expect(pollBefore?.options?.every((o) => !!o.id)).toBe(true)

    const updated = await mcpUpdateList(ownerId, 'mowner', slug, { items: before.steps })
    expect('error' in updated).toBe(false)
    const after = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { steps: McpItemInput[] }

    expect(after.steps.map((b) => b.bid)).toEqual(before.steps.map((b) => b.bid))
    expect(after.steps.find((b) => b.type === 'poll')?.options).toEqual(pollBefore?.options)
    expect(after.steps.find((b) => b.type === 'step')).toMatchObject({
      needsHuman: true,
      needsHumanAsk: 'сколько стоит у вас?',
      imageRef: 'uploads/shot.webp',
    })
  })
})

describe('patch_list — точечная правка вместо перезаписи всего списка', () => {
  const three = async () => {
    const created = await mcpCreateList(ownerId, {
      title: 'Patchable',
      items: [{ title: 'install', command: 'winget install X' }, { type: 'text', text: 'врезка' }, { title: 'configure' }],
    })
    const slug = refSlug((created as { ref: string }).ref)
    const read = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { version: number; steps: McpItemInput[] }
    return { slug, read }
  }

  it('правит один блок: соседи и их идентичность не тронуты', async () => {
    const { slug, read } = await three()
    const target = read.steps[0]
    const res = await mcpPatchList(ownerId, 'mowner', slug, {
      baseVersion: read.version,
      ops: [{ op: 'update', bid: target.bid, title: 'Установить X' }],
    })
    expect('error' in res).toBe(false)

    const after = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { steps: McpItemInput[] }
    expect(after.steps.map((b) => b.bid)).toEqual(read.steps.map((b) => b.bid))
    // Заголовок сменился, команда того же блока — нет (патч частичный).
    expect(after.steps[0]).toMatchObject({ title: 'Установить X', command: 'winget install X' })
    expect(after.steps[1]).toEqual(read.steps[1])
    expect(after.steps[2]).toEqual(read.steps[2])
  })

  it('вставка, удаление и перестановка идут одним патчем', async () => {
    const { slug, read } = await three()
    const [a, b, c] = read.steps.map((s) => s.bid)
    const res = await mcpPatchList(ownerId, 'mowner', slug, {
      baseVersion: read.version,
      ops: [
        { op: 'insert', after: a, block: { type: 'text', text: 'новая врезка' } },
        { op: 'delete', bid: b },
        { op: 'move', bid: c, after: 'start' },
      ],
    })
    expect('error' in res).toBe(false)

    const after = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { steps: McpItemInput[] }
    expect(after.steps.map((s) => s.type)).toEqual(['step', 'step', 'text'])
    expect(after.steps[0].bid).toBe(c)
    expect(after.steps[1].bid).toBe(a)
    expect(after.steps[2].text).toBe('новая врезка')
  })

  it('чужая версия → отказ, список не тронут', async () => {
    const { slug, read } = await three()
    const res = await mcpPatchList(ownerId, 'mowner', slug, {
      baseVersion: read.version + 5,
      ops: [{ op: 'delete', bid: read.steps[0].bid }],
    })
    expect(res).toMatchObject({ error: expect.stringContaining('list changed') })
    const after = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { steps: McpItemInput[] }
    expect(after.steps.map((b) => b.bid)).toEqual(read.steps.map((b) => b.bid))
  })

  it('ошибка в одной операции отменяет весь патч — в списке ничего не изменилось', async () => {
    const { slug, read } = await three()
    const res = await mcpPatchList(ownerId, 'mowner', slug, {
      baseVersion: read.version,
      ops: [{ op: 'update', bid: read.steps[0].bid, title: 'изменено' }, { op: 'delete', bid: 'no-such-block' }],
    })
    expect(res).toMatchObject({ error: expect.stringContaining('op #2') })
    const after = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { steps: McpItemInput[] }
    expect(after.steps[0].title).toBe('install')
  })

  // Идентичность приходит снаружи, а steps.block_id — колонка uuid. Мусорное
  // значение роняло вставку УЖЕ ПОСЛЕ удаления старых шагов, и черновик оставался
  // пустым: правка через API теряла работу владельца целиком.
  it('нераспознанный bid не оставляет черновик пустым', async () => {
    const { slug, read } = await three()
    const res = await mcpUpdateList(ownerId, 'mowner', slug, {
      items: read.steps.map((b, i) => (i === 0 ? { ...b, bid: 'not-a-uuid' } : b)),
    })
    expect('error' in res).toBe(false)
    const after = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { steps: McpItemInput[] }
    expect(after.steps).toHaveLength(read.steps.length)
    // Блок уцелел и получил канонический id вместо мусорного.
    expect(after.steps[0].title).toBe('install')
    expect(after.steps[0].bid).not.toBe('not-a-uuid')
  })

  it('патчить чужой список нельзя', async () => {
    const { slug, read } = await three()
    const res = await mcpPatchList(otherId, 'mowner', slug, {
      baseVersion: read.version,
      ops: [{ op: 'delete', bid: read.steps[0].bid }],
    })
    expect(res).toMatchObject({ error: expect.stringContaining('forbidden') })
  })
})
