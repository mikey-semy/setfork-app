import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * РЕЛИЗЫ ЧЕРЕЗ MCP НА НАСТОЯЩЕЙ БАЗЕ.
 *
 * Подменено одно внешнее — ядро git (тег ставит оно). Всё остальное настоящее: права,
 * версии, уникальность тега, запись. Проверяется то, ради чего правила вынесены в
 * `features/releases/core`, а не скопированы в инструмент:
 *
 *  • отказ НИЧЕГО не пишет — ни строки релиза, ни тега в git: отказ после записи
 *    выглядит так же, как отсутствие отказа;
 *  • сбой ядра на теге не оставляет релиза без тега (#590) и у агента;
 *  • чужой список агенту отказывает словами, приватный — не существует;
 *  • сгенерированные заметки встают ПОД свой текст, как у GitHub.
 */
const h = vi.hoisted(() => ({ tags: [] as { owner: string; slug: string; tag: string; version: number }[], failTag: false }))

vi.mock('@/features/git/core', () => ({
  gitCore: {
    createTag: async (repo: { owner: string; slug: string }, tag: string, version: number) => {
      if (h.failTag) throw new Error('core unavailable')
      h.tags.push({ ...repo, tag, version })
    },
  },
}))

const { db, users, templates, templateVersions, steps, releases } = await import('@/shared/db')
const { mcpCreateRelease, mcpListReleases } = await import('@/features/mcp/tools')

const OWNER = 'rel-owner'
const LIST = `${OWNER}/rel-kit`
let ownerId = ''
let strangerId = ''
let templateId = ''

beforeAll(async () => {
  await resetTables([releases, templates, users])
  const rows = await db
    .insert(users)
    .values([{ handle: OWNER }, { handle: 'rel-stranger' }])
    .returning({ id: users.id, handle: users.handle })
  ownerId = rows.find((r) => r.handle === OWNER)!.id
  strangerId = rows.find((r) => r.handle === 'rel-stranger')!.id
})

beforeEach(async () => {
  h.tags = []
  h.failTag = false
  await db.delete(releases)
  await db.delete(templates)
  const [t] = await db
    .insert(templates)
    .values({ ownerId, slug: 'rel-kit', title: { en: 'kit' }, currentVersion: 2, status: 'published', visibility: 'public', moderation: 'active' })
    .returning({ id: templates.id })
  templateId = t.id
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

describe('create_release', () => {
  it('владелец выпускает релиз: тег в git на ту версию, заметки как есть, в выдаче — последний', async () => {
    const notes = '## What changed\n\n- scripts are real files now'
    const res = await mcpCreateRelease(ownerId, { list: LIST, tag: 'v0.5.1', title: 'Depersonalised', notes })
    expect(res).toMatchObject({ ref: LIST, tag: 'v0.5.1', version: 2 })
    expect(h.tags).toEqual([{ owner: OWNER, slug: 'rel-kit', tag: 'v0.5.1', version: 2 }])
    const [row] = await rows()
    expect(row).toMatchObject({ tag: 'v0.5.1', version: 2, title: 'Depersonalised', notes, prerelease: false, authorId: ownerId })

    const list = await mcpListReleases(strangerId, { list: LIST })
    expect(list).toMatchObject({ total: 1, releases: [{ tag: 'v0.5.1', version: 2, latest: true, author: OWNER, notes }] })
  })

  it('сгенерированное встаёт ПОД свой текст', async () => {
    await mcpCreateRelease(ownerId, { list: LIST, tag: '1.0.0', notes: 'Intro line', generateNotes: true })
    const [row] = await rows()
    expect(row.notes.startsWith('Intro line\n\n')).toBe(true)
    expect(row.notes).toContain('Run the review')
    expect(row.notes).not.toContain('Clone the repo')
  })

  it('посторонний на публичном списке — отказ словами, ни строки, ни тега', async () => {
    const res = await mcpCreateRelease(strangerId, { list: LIST, tag: 'v9.9' })
    expect(res).toEqual({ error: expect.stringContaining('owner or a collaborator') })
    expect(await rows()).toHaveLength(0)
    expect(h.tags).toHaveLength(0)
  })

  it('приватный чужой список для постороннего не существует — и для чтения тоже', async () => {
    await db.update(templates).set({ visibility: 'private' }).where(eq(templates.id, templateId))
    expect(await mcpCreateRelease(strangerId, { list: LIST, tag: 'v9.9' })).toEqual({ error: 'list not found' })
    expect(await mcpListReleases(strangerId, { list: LIST })).toEqual({ error: 'list not found' })
    expect(h.tags).toHaveLength(0)
  })

  it.each([
    ['v3', 'reserved'],
    ['не тег', 'letters, digits'],
  ])('тег «%s» — отказ до ядра', async (tag, words) => {
    const res = await mcpCreateRelease(ownerId, { list: LIST, tag })
    expect(res).toEqual({ error: expect.stringContaining(words) })
    expect(h.tags).toHaveLength(0)
    expect(await rows()).toHaveLength(0)
  })

  it('несуществующая версия и занятый тег — отказ, второй записи нет', async () => {
    expect(await mcpCreateRelease(ownerId, { list: LIST, tag: 'x', version: 7 })).toEqual({ error: expect.stringContaining('no such version') })
    await mcpCreateRelease(ownerId, { list: LIST, tag: 'x' })
    expect(await mcpCreateRelease(ownerId, { list: LIST, tag: 'x', version: 1 })).toEqual({ error: expect.stringContaining('already exists') })
    expect(await rows()).toHaveLength(1)
  })

  it('ядро не поставило тег — релиза нет', async () => {
    h.failTag = true
    expect(await mcpCreateRelease(ownerId, { list: LIST, tag: 'v1.0' })).toEqual({ error: expect.stringContaining('nothing was published') })
    expect(await rows()).toHaveLength(0)
  })
})
