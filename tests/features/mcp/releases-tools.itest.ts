import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * РЕЛИЗЫ ЧЕРЕЗ MCP НА НАСТОЯЩЕЙ БАЗЕ.
 *
 * Подменено одно внешнее — ядро git: оно держит теги (`listTags`) и ставит новый
 * (`createTag`, как настоящее — с перезаписью). Всё остальное настоящее: права,
 * видимость, архив, версии, уникальность тега, замок, запись. Проверяется то, ради
 * чего правила вынесены в `features/releases/core`, а не скопированы в инструмент:
 *
 *  • отказ НИЧЕГО не пишет — ни строки релиза, ни тега в git: отказ после записи
 *    выглядит так же, как отсутствие отказа;
 *  • занятый тег не переезжает — ни занятый релизом, ни git-тег на другой версии
 *    (ядро перевешивает теги силой, спросить его некому, кроме нас);
 *  • сбой ядра на теге не оставляет релиза без тега (#590);
 *  • права: владелец и соавтор — да, посторонний — отказ словами, невидимый — «нет такого»;
 *  • сгенерированные заметки встают ПОД свой текст, как у GitHub, и агент видит, что записано.
 */
const h = vi.hoisted(() => ({
  tags: new Map<string, string>(),
  created: [] as string[],
  failTag: null as null | Error,
  noCore: false,
}))

vi.mock('@/features/git/core', () => ({
  gitCore: {
    listTags: async () => (h.noCore ? [] : [...h.tags].map(([name, targetSha]) => ({ name, targetSha }))),
    createTag: async (_repo: unknown, tag: string, version: number) => {
      if (h.failTag) throw h.failTag
      // Настоящее ядро отвечает не мгновенно: без паузы два одновременных выпуска
      // успевали бы разойтись сами, и гонку, против которой стоит замок, тест не видел бы.
      await new Promise((r) => setTimeout(r, 30))
      h.tags.set(tag, `sha-v${version}`)
      h.created.push(`${tag}@v${version}`)
    },
  },
}))

const { db, users, templates, templateVersions, steps, releases, collaborators } = await import('@/shared/db')
const { BranchOpError } = await import('@/core')
const { mcpCreateRelease, mcpListReleases } = await import('@/features/mcp/tools')
const { publishRelease } = await import('@/features/releases/core')

const OWNER = 'rel-owner'
const LIST = `${OWNER}/rel-kit`
let ownerId = ''
let strangerId = ''
let collabId = ''
let templateId = ''

/** Выпуск сразу со вторым шагом — отчёт без записи проверяется отдельно. */
const release = (userId: string, args: Record<string, unknown>) =>
  mcpCreateRelease(userId, { list: LIST, tag: '', ...args, confirm: true } as Parameters<typeof mcpCreateRelease>[1])

beforeAll(async () => {
  await resetTables([releases, collaborators, templates, users])
  const rows = await db
    .insert(users)
    .values([{ handle: OWNER }, { handle: 'rel-stranger' }, { handle: 'rel-collab' }])
    .returning({ id: users.id, handle: users.handle })
  const id = (handle: string) => rows.find((r) => r.handle === handle)!.id
  ownerId = id(OWNER)
  strangerId = id('rel-stranger')
  collabId = id('rel-collab')
})

beforeEach(async () => {
  h.tags = new Map([
    ['v1', 'sha-v1'],
    ['v2', 'sha-v2'],
  ])
  h.created = []
  h.failTag = null
  h.noCore = false
  await db.delete(releases)
  await db.delete(templates)
  const [t] = await db
    .insert(templates)
    .values({ ownerId, slug: 'rel-kit', title: { en: 'kit' }, currentVersion: 2, status: 'published', visibility: 'public', moderation: 'active' })
    .returning({ id: templates.id })
  templateId = t.id
  await db.insert(collaborators).values({ templateId, userId: collabId })
  const vs = await db
    .insert(templateVersions)
    .values([
      { templateId, version: 1, note: 'v1' },
      { templateId, version: 2, note: 'v2' },
    ])
    .returning({ id: templateVersions.id, version: templateVersions.version })
  const v1 = vs.find((v) => v.version === 1)!.id
  const v2 = vs.find((v) => v.version === 2)!.id
  await db.insert(steps).values([
    { versionId: v1, n: 1, title: { en: 'Clone the repo' } },
    { versionId: v2, n: 1, title: { en: 'Clone the repo' } },
    { versionId: v2, n: 2, title: { en: 'Run the review' } },
  ])
})

const rows = () => db.select().from(releases).where(eq(releases.templateId, templateId))
const setList = (patch: Partial<typeof templates.$inferInsert>) => db.update(templates).set(patch).where(eq(templates.id, templateId))

describe('create_release: выпуск', () => {
  it('без confirm — только отчёт: ни строки, ни тега', async () => {
    const res = await mcpCreateRelease(ownerId, { list: LIST, tag: 'v0.5.1', notes: 'x' })
    expect(res).toMatchObject({ wouldPublish: { tag: 'v0.5.1', version: 'current' }, visibleTo: expect.stringContaining('everyone') })
    expect(await rows()).toHaveLength(0)
    expect(h.created).toEqual([])
  })

  it('владелец выпускает релиз: тег в git на ту версию, заметки как есть, в выдаче — последний', async () => {
    const notes = '## What changed\n\n- scripts are real files now'
    const res = await release(ownerId, { tag: 'v0.5.1', title: 'Depersonalised', notes })
    expect(res).toMatchObject({ ref: LIST, tag: 'v0.5.1', version: 2, notes, note: expect.stringContaining('Atom') })
    expect(h.created).toEqual(['v0.5.1@v2'])
    const [row] = await rows()
    expect(row).toMatchObject({ tag: 'v0.5.1', version: 2, title: 'Depersonalised', notes, prerelease: false, authorId: ownerId })

    const list = await mcpListReleases(strangerId, { list: LIST })
    expect(list).toMatchObject({ total: 1, releases: [{ tag: 'v0.5.1', version: 2, latest: true, author: OWNER, notes }] })
  })

  it('явная версия ложится на неё, пред-релиз не становится «последним»', async () => {
    await release(ownerId, { tag: '1.0.0', version: 1 })
    await release(ownerId, { tag: '2.0.0-rc1', version: 2, prerelease: true })
    expect(h.created).toEqual(['1.0.0@v1', '2.0.0-rc1@v2'])
    const list = await mcpListReleases(ownerId, { list: LIST, limit: 1 })
    expect(list).toMatchObject({ total: 2, nextPage: 2, releases: [{ tag: '2.0.0-rc1', prerelease: true }] })
    expect((list as { releases: { latest?: boolean }[] }).releases[0].latest).toBeUndefined()
    const second = await mcpListReleases(ownerId, { list: LIST, limit: 1, page: 2 })
    expect(second).toMatchObject({ page: 2, releases: [{ tag: '1.0.0', latest: true }] })
    expect(second).not.toHaveProperty('nextPage')
  })

  it('сгенерированное встаёт ПОД свой текст, и агенту возвращается записанное', async () => {
    const res = await release(ownerId, { tag: '1.0.0', notes: 'Intro line', generateNotes: true })
    const [row] = await rows()
    expect(row.notes.startsWith('Intro line\n\n')).toBe(true)
    expect(row.notes).toContain('Run the review')
    expect(row.notes).not.toContain('Clone the repo')
    expect(res).toMatchObject({ notes: row.notes })
    expect(res).not.toHaveProperty('truncated')
  })

  it('заметки длиннее предела обрезаются — и агенту об этом сказано', async () => {
    const res = await release(ownerId, { tag: '1.0.0', notes: 'x'.repeat(49_990), generateNotes: true })
    const [row] = await rows()
    expect(row.notes).toHaveLength(50_000)
    expect(res).toMatchObject({ truncated: true })
  })
})

describe('create_release: кто может', () => {
  it('соавтор выпускает и на приватном списке', async () => {
    await setList({ visibility: 'private' })
    const res = await release(collabId, { tag: '1.0.0' })
    expect(res).toMatchObject({ tag: '1.0.0', note: expect.stringContaining('not public') })
    expect(await rows()).toHaveLength(1)
  })

  it('посторонний на публичном списке — отказ словами, ни строки, ни тега', async () => {
    const res = await release(strangerId, { tag: 'v9.9' })
    expect(res).toEqual({ error: expect.stringContaining('owner or a collaborator') })
    expect(await rows()).toHaveLength(0)
    expect(h.created).toEqual([])
  })

  it('приватный чужой список для постороннего не существует — и для чтения тоже', async () => {
    await setList({ visibility: 'private' })
    expect(await release(strangerId, { tag: 'v9.9' })).toEqual({ error: 'list not found' })
    expect(await mcpListReleases(strangerId, { list: LIST })).toEqual({ error: 'list not found' })
    expect(h.created).toEqual([])
  })

  it('снятый модерацией: соавтору «нет такого» — и у агента, и у формы', async () => {
    await setList({ moderation: 'hidden' })
    expect(await release(collabId, { tag: '1.0.0' })).toEqual({ error: 'list not found' })
    // Форма зовёт ядро напрямую, мимо проверки видимости в обёртке MCP: раньше именно
    // так соавтор снятого списка выпускал релиз, которого агенту не давали.
    expect(await publishRelease(collabId, templateId, { tag: '1.0.0' })).toEqual({ ok: false, reason: 'not_found' })
    expect(h.created).toEqual([])
  })

  it('архив — отказ, который прямо говорит, что повтор не поможет', async () => {
    await setList({ archivedAt: new Date() })
    expect(await release(ownerId, { tag: '1.0.0' })).toEqual({ error: expect.stringContaining('archived or frozen') })
    expect(h.created).toEqual([])
    expect(await rows()).toHaveLength(0)
  })
})

describe('create_release: тег', () => {
  it.each([
    ['v3', 'reserved'],
    ['не тег', 'bad tag'],
    ['1.2.', 'bad tag'],
    ['-rc1', 'bad tag'],
    ['a..b', 'bad tag'],
  ])('тег «%s» — отказ до ядра', async (tag, words) => {
    expect(await release(ownerId, { tag })).toEqual({ error: expect.stringContaining(words) })
    expect(h.created).toEqual([])
    expect(await rows()).toHaveLength(0)
  })

  it('несуществующая версия и занятый релизом тег — отказ, второй записи нет', async () => {
    expect(await release(ownerId, { tag: 'x', version: 7 })).toEqual({ error: expect.stringContaining('no such version') })
    await release(ownerId, { tag: 'x' })
    expect(await release(ownerId, { tag: 'x', version: 1 })).toEqual({ error: expect.stringContaining('taken') })
    expect(await rows()).toHaveLength(1)
    expect(h.tags.get('x')).toBe('sha-v2')
  })

  it('git-тег с тем же именем на ДРУГОЙ версии не переезжает', async () => {
    h.tags.set('1.0', 'sha-v1')
    expect(await release(ownerId, { tag: '1.0', version: 2 })).toEqual({ error: expect.stringContaining('taken') })
    expect(h.tags.get('1.0')).toBe('sha-v1')
    expect(h.created).toEqual([])
  })

  it('git-тег на ТОЙ ЖЕ версии без релиза — повтор после сбоя записи, пропускаем', async () => {
    h.tags.set('1.0', 'sha-v2')
    expect(await release(ownerId, { tag: '1.0', version: 2 })).toMatchObject({ tag: '1.0' })
    expect(await rows()).toHaveLength(1)
  })

  it('два одновременных выпуска одного тега на разные версии: один релиз, тег за ним', async () => {
    const [a, b] = await Promise.all([release(ownerId, { tag: '1.0', version: 1 }), release(ownerId, { tag: '1.0', version: 2 })])
    const won = [a, b].filter((r) => !('error' in r))
    expect(won).toHaveLength(1)
    const [row] = await rows()
    expect(h.tags.get('1.0')).toBe(`sha-v${row.version}`)
    expect(h.created).toHaveLength(1)
  })

  it('ядро не поставило тег — релиза нет; не ответило про теги — тоже', async () => {
    h.failTag = new Error('core unavailable')
    expect(await release(ownerId, { tag: 'v1.0' })).toEqual({ error: expect.stringContaining('nothing was published') })
    h.failTag = null
    h.noCore = true
    expect(await release(ownerId, { tag: 'v1.0' })).toEqual({ error: expect.stringContaining('nothing was published') })
    expect(await rows()).toHaveLength(0)
  })

  it('имя, которое не приняло ядро, — ошибка ввода, а не «повтори»', async () => {
    h.failTag = new BranchOpError('bad-name')
    expect(await release(ownerId, { tag: 'ok-here' })).toEqual({ error: expect.stringContaining('bad tag') })
  })
})
