import { and, asc, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { McpItemInput } from '@/features/mcp/tools'

// MCP-инструменты берут userId прямо из токена (не cookie-сессия) → тестируются без
// моков, чистой БД. Сквозной поток create→get→update + проверки владения/видимости:
// список создаётся ЧЕРНОВИКОМ (виден только владельцу), обновлять может только владелец.
const { db, runs, runStepState, steps, templates, templateVersions, users } = await import('@/shared/db')
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

  // Патч правит ОДИН блок, но список переписывается целиком — значит всё, чего
  // плоская форма MCP не умеет выразить (переводы, товары), обязано ехать мимо неё.
  it('перевод соседнего блока и товары переживают патч', async () => {
    const created = await mcpCreateList(ownerId, { title: 'Mixed', items: [{ title: 'one' }, { title: 'two' }] })
    const slug = refSlug((created as { ref: string }).ref)
    const [{ id: tplId }] = await db.select({ id: templates.id }).from(templates).where(eq(templates.slug, slug))
    const [ver] = await db.select({ id: templateVersions.id }).from(templateVersions).where(eq(templateVersions.templateId, tplId))

    // Двуязычный шаг и подборка товаров кладём напрямую: через MCP их пока не создать.
    await db
      .update(steps)
      .set({ title: { en: 'two', ru: 'второй' }, desc: { en: 'about', ru: 'описание' } })
      .where(and(eq(steps.versionId, ver.id), eq(steps.n, 2)))
    await db.insert(steps).values({
      versionId: ver.id,
      n: 3,
      type: 'product',
      content: { bid: 'prod-1', title: 'Инструменты', items: [{ name: 'Отвёртка', url: 'https://example.com/x' }] },
      title: {},
      desc: {},
      command: '',
      level: 'required',
      why: {},
      section: {},
      subtasks: [],
      refs: [],
    })

    const read = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { version: number; steps: McpItemInput[] }
    const first = read.steps.find((b) => b.title === 'one')
    const res = await mcpPatchList(ownerId, 'mowner', slug, {
      baseVersion: read.version,
      ops: [{ op: 'update', bid: first?.bid, title: 'ONE' }],
    })
    expect('error' in res).toBe(false)

    const rows = await db.select().from(steps).where(eq(steps.versionId, ver.id)).orderBy(asc(steps.n))
    // Русский перевод НЕ тронутого патчем блока на месте.
    expect(rows.find((r) => (r.title as Record<string, string>).en === 'two')?.title).toEqual({ en: 'two', ru: 'второй' })
    // Подборка товаров не превратилась в пустой шаг и не исчезла.
    const product = rows.find((r) => r.type === 'product')
    expect(product?.content).toMatchObject({ title: 'Инструменты' })
  })

  it('товары через API не патчатся — честный отказ вместо тихой порчи', async () => {
    const created = await mcpCreateList(ownerId, { title: 'WithProduct', items: [{ title: 'one' }] })
    const slug = refSlug((created as { ref: string }).ref)
    const [{ id: tplId }] = await db.select({ id: templates.id }).from(templates).where(eq(templates.slug, slug))
    const [ver] = await db.select({ id: templateVersions.id }).from(templateVersions).where(eq(templateVersions.templateId, tplId))
    await db.insert(steps).values({
      versionId: ver.id,
      n: 2,
      type: 'product',
      content: { bid: 'prod-2', title: 'Набор', items: [{ name: 'Ключ', url: 'https://example.com/k' }] },
      title: {},
      desc: {},
      command: '',
      level: 'required',
      why: {},
      section: {},
      subtasks: [],
      refs: [],
    })
    const read = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { version: number; steps: McpItemInput[] }
    const prod = read.steps.find((b) => b.bid === 'prod-2')
    const res = await mcpPatchList(ownerId, 'mowner', slug, {
      baseVersion: read.version,
      ops: [{ op: 'update', bid: prod?.bid, title: 'другое' }],
    })
    expect(res).toMatchObject({ error: expect.stringContaining('product') })
  })

  // У черновика номер версии не растёт — сверять «правка основана на текущей»
  // там нечем, и два патча с одним baseVersion оба прошли бы проверку. Защищает
  // замок: чтение состава и его замена идут под ним, поэтому второй патч видит
  // результат первого, а не свой устаревший снимок.
  it('два одновременных патча черновика не теряют друг друга', async () => {
    const { slug, read } = await three()
    const [a, , c] = read.steps.map((s) => s.bid)
    const [r1, r2] = await Promise.all([
      mcpPatchList(ownerId, 'mowner', slug, { baseVersion: read.version, ops: [{ op: 'update', bid: a, title: 'ПЕРВЫЙ' }] }),
      mcpPatchList(ownerId, 'mowner', slug, { baseVersion: read.version, ops: [{ op: 'update', bid: c, title: 'ТРЕТИЙ' }] }),
    ])
    expect('error' in r1).toBe(false)
    expect('error' in r2).toBe(false)

    const after = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { steps: McpItemInput[] }
    // Обе правки на месте: ни одна не была затёрта снимком другой.
    expect(after.steps.find((b) => b.bid === a)?.title).toBe('ПЕРВЫЙ')
    expect(after.steps.find((b) => b.bid === c)?.title).toBe('ТРЕТИЙ')
  })

  it('явная очистка поля применяется, а не тонет в слиянии со старым', async () => {
    const created = await mcpCreateList(ownerId, {
      title: 'Clearing',
      items: [
        { title: 'step' },
        { type: 'poll', question: 'что ставим?', options: [{ text: 'winget' }, { text: 'msi' }], multi: true, deadline: '2030-01-01' },
      ],
    })
    const slug = refSlug((created as { ref: string }).ref)
    const read = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { version: number; steps: McpItemInput[] }
    const poll = read.steps.find((b) => b.type === 'poll')
    expect(poll).toMatchObject({ multi: true, deadline: '2030-01-01' })

    const res = await mcpPatchList(ownerId, 'mowner', slug, {
      baseVersion: read.version,
      ops: [{ op: 'update', bid: poll?.bid, multi: false, deadline: '' }],
    })
    expect('error' in res).toBe(false)
    const after = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { steps: McpItemInput[] }
    const patched = after.steps.find((b) => b.type === 'poll')
    expect(patched?.multi).toBeUndefined()
    expect(patched?.deadline).toBeUndefined()
    expect(patched?.question).toBe('что ставим?') // не тронутое поле на месте
  })

  it('секция правится и у блока без заголовка (не только у шага)', async () => {
    const created = await mcpCreateList(ownerId, {
      title: 'Sections',
      items: [{ title: 'step', section: 'Урок 1' }, { type: 'text', text: 'врезка', section: 'Урок 1' }],
    })
    const slug = refSlug((created as { ref: string }).ref)
    const read = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { version: number; steps: McpItemInput[] }
    // Секция доезжает при создании — раньше её переносила только step-ветка.
    expect(read.steps.find((b) => b.type === 'text')?.section).toBe('Урок 1')

    const text = read.steps.find((b) => b.type === 'text')
    const res = await mcpPatchList(ownerId, 'mowner', slug, {
      baseVersion: read.version,
      ops: [{ op: 'update', bid: text?.bid, section: 'Урок 2' }],
    })
    expect('error' in res).toBe(false)
    const after = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { steps: McpItemInput[] }
    expect(after.steps.find((b) => b.type === 'text')).toMatchObject({ section: 'Урок 2', text: 'врезка' })
  })

  // Правка ложится в ТУ локаль, из которой чтение взяло показанное значение.
  // Иначе она обновит другой перевод, а get_list продолжит отдавать прежний текст.
  it('правка двуязычного поля видна в ответе и не портит второй перевод', async () => {
    const created = await mcpCreateList(ownerId, { title: 'Locales', items: [{ title: 'one' }] })
    const slug = refSlug((created as { ref: string }).ref)
    const [{ id: tplId }] = await db.select({ id: templates.id }).from(templates).where(eq(templates.slug, slug))
    const [ver] = await db.select({ id: templateVersions.id }).from(templateVersions).where(eq(templateVersions.templateId, tplId))
    // Порядок ключей — русский первым: раньше правка уходила именно в него, хотя
    // наружу отдавался английский.
    await db.update(steps).set({ title: { ru: 'старое', en: 'old' } }).where(eq(steps.versionId, ver.id))

    const read = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { version: number; steps: McpItemInput[] }
    expect(read.steps[0].title).toBe('old')
    const res = await mcpPatchList(ownerId, 'mowner', slug, {
      baseVersion: read.version,
      ops: [{ op: 'update', bid: read.steps[0].bid, title: 'new' }],
    })
    expect('error' in res).toBe(false)

    const after = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { steps: McpItemInput[] }
    expect(after.steps[0].title).toBe('new') // правка ВИДНА
    const [row] = await db.select({ title: steps.title }).from(steps).where(eq(steps.versionId, ver.id))
    expect(row.title).toEqual({ ru: 'старое', en: 'new' }) // второй перевод цел
  })

  it('очистка поля убирает только показанную локаль, второй перевод цел', async () => {
    const created = await mcpCreateList(ownerId, { title: 'Clear locale', items: [{ title: 'one', desc: 'About' }] })
    const slug = refSlug((created as { ref: string }).ref)
    const [{ id: tplId }] = await db.select({ id: templates.id }).from(templates).where(eq(templates.slug, slug))
    const [ver] = await db.select({ id: templateVersions.id }).from(templateVersions).where(eq(templateVersions.templateId, tplId))
    await db.update(steps).set({ desc: { en: 'About', ru: 'Описание' } }).where(eq(steps.versionId, ver.id))

    const read = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { version: number; steps: McpItemInput[] }
    const res = await mcpPatchList(ownerId, 'mowner', slug, {
      baseVersion: read.version,
      ops: [{ op: 'update', bid: read.steps[0].bid, desc: '' }],
    })
    expect('error' in res).toBe(false)
    const [row] = await db.select({ desc: steps.desc }).from(steps).where(eq(steps.versionId, ver.id))
    expect(row.desc).toEqual({ ru: 'Описание' }) // русский перевод НЕ снесён вместе с английским
  })

  // Полная замена (update_list) и патч правят один черновик разными путями —
  // и обязаны идти через один замок, иначе чья-то работа исчезает при двух
  // «успешных» ответах.
  it('патч и полная замена черновика не переплетаются', async () => {
    const { slug, read } = await three()
    const [a] = read.steps.map((s) => s.bid)
    const [rPatch, rReplace] = await Promise.all([
      mcpPatchList(ownerId, 'mowner', slug, { baseVersion: read.version, ops: [{ op: 'update', bid: a, title: 'ИЗ ПАТЧА' }] }),
      mcpUpdateList(ownerId, 'mowner', slug, { items: [...read.steps, { title: 'из полной замены' }] }),
    ])
    expect('error' in rPatch).toBe(false)
    expect('error' in rReplace).toBe(false)

    // Кто бы ни записал вторым, список остаётся целым и непротиворечивым: либо
    // 3 блока с правкой патча, либо 4 блока полной замены — но не мешанина.
    const after = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { steps: McpItemInput[] }
    expect([3, 4]).toContain(after.steps.length)
    expect(after.steps.every((b) => !!b.bid)).toBe(true)
  })

  // Страж разрушительных команд стоит в фасаде записи версий, а прямая правка
  // черновика шла мимо него: через API можно было положить в черновик команду,
  // которую get_script отдаёт готовым к запуску скриптом.
  it('разрушительная команда не проходит и в черновик', async () => {
    const { slug, read } = await three()
    const res = await mcpPatchList(ownerId, 'mowner', slug, {
      baseVersion: read.version,
      ops: [{ op: 'update', bid: read.steps[0].bid, command: 'rm -rf /' }],
    })
    expect(res).toMatchObject({ error: expect.stringContaining('destructive') })
    const after = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { steps: McpItemInput[] }
    expect(after.steps[0].command).not.toContain('rm -rf')
  })

  // steps.id — якорь состояния прогона (run_step_state.step_id, ON DELETE CASCADE).
  // Полная перезапись строк стирала прогресс идущего прогона, оставляя его активным.
  it('патч не сбрасывает прогресс активного прогона', async () => {
    const { slug, read } = await three()
    const [{ id: tplId }] = await db.select({ id: templates.id }).from(templates).where(eq(templates.slug, slug))
    const [ver] = await db.select({ id: templateVersions.id }).from(templateVersions).where(eq(templateVersions.templateId, tplId))
    const rows = await db.select({ id: steps.id }).from(steps).where(eq(steps.versionId, ver.id)).orderBy(asc(steps.n))
    const [run] = await db
      .insert(runs)
      .values({ templateId: tplId, userId: ownerId, versionId: ver.id, version: read.version })
      .returning({ id: runs.id })
    await db.insert(runStepState).values({ runId: run.id, stepId: rows[0].id, status: 'done' })

    const res = await mcpPatchList(ownerId, 'mowner', slug, {
      baseVersion: read.version,
      ops: [{ op: 'update', bid: read.steps[2].bid, title: 'третий, переименован' }],
    })
    expect('error' in res).toBe(false)

    const state = await db.select({ stepId: runStepState.stepId, status: runStepState.status }).from(runStepState).where(eq(runStepState.runId, run.id))
    expect(state).toHaveLength(1) // отметка «сделано» пережила правку соседнего блока
    expect(state[0].stepId).toBe(rows[0].id)
  })

  // Строки состояния заводятся разом при СТАРТЕ прогона. Блок, вставленный
  // позже, без своей строки не отмечается вовсе — ни в вебе, ни через API.
  it('вставленный блок получает состояние в идущем прогоне', async () => {
    const { slug, read } = await three()
    const [{ id: tplId }] = await db.select({ id: templates.id }).from(templates).where(eq(templates.slug, slug))
    const [ver] = await db.select({ id: templateVersions.id }).from(templateVersions).where(eq(templateVersions.templateId, tplId))
    const before = await db.select({ id: steps.id }).from(steps).where(eq(steps.versionId, ver.id))
    const [run] = await db
      .insert(runs)
      .values({ templateId: tplId, userId: ownerId, versionId: ver.id, version: read.version })
      .returning({ id: runs.id })
    await db.insert(runStepState).values(before.map((s) => ({ runId: run.id, stepId: s.id })))

    const res = await mcpPatchList(ownerId, 'mowner', slug, {
      baseVersion: read.version,
      ops: [{ op: 'insert', after: 'end', block: { title: 'новый шаг' } }],
    })
    expect('error' in res).toBe(false)

    const stepRows = await db.select({ id: steps.id, type: steps.type }).from(steps).where(eq(steps.versionId, ver.id))
    const states = await db.select({ stepId: runStepState.stepId }).from(runStepState).where(eq(runStepState.runId, run.id))
    const stepIds = stepRows.filter((r) => r.type === 'step').map((r) => r.id)
    // У КАЖДОГО шаг-блока есть строка состояния, включая только что вставленный.
    expect(new Set(states.map((s) => s.stepId))).toEqual(new Set(stepIds))
  })

  it('два блока с одним bid отбиваются, список не теряет блок', async () => {
    const { slug, read } = await three()
    const res = await mcpUpdateList(ownerId, 'mowner', slug, {
      items: [...read.steps, { ...read.steps[0], title: 'клон первого' }],
    })
    expect(res).toMatchObject({ error: expect.stringContaining('same bid') })
    const after = (await mcpGetList(ownerId, 'mowner', slug)) as unknown as { steps: McpItemInput[] }
    expect(after.steps).toHaveLength(read.steps.length)
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
