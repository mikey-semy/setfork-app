import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

// Авто-модерация требует ключа модели: без него `publicationDecision` отвечает «gate-off»,
// и проверка «уходит на модерацию» проверяла бы отсутствие ключа, а не поведение гейта.
vi.mock('@/shared/settings/ai', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getApiKey: vi.fn(async () => 'test-key'),
}))

// РАЗБОР ЧЕРНОВИКОВ ЧЕРЕЗ MCP. Инструмент опасен ровно тем, чем полезен: одним вызовом
// список становится публичным. Поэтому тесты держат три вещи: сухой прогон по умолчанию,
// чужое и не-черновики не трогаются, и — главное — публикация НЕ обходит модерацию:
// публичный список уходит в очередь проверки, а снятый модерацией не «отмывается».
const { db, jobs, templates, users } = await import('@/shared/db')
const { MCP_PUBLISH_MAX, mcpMyDrafts, mcpPublishLists } = await import('@/features/mcp/tools')

let meId = ''
let otherId = ''

const draft = async (ownerId: string, slug: string, over: Partial<typeof templates.$inferInsert> = {}) => {
  const [t] = await db
    .insert(templates)
    .values({ ownerId, slug, title: { en: slug }, tags: ['skill'], status: 'draft', visibility: 'public', ...over })
    .returning({ id: templates.id })
  return t.id
}

const statusOf = async (slug: string) =>
  (await db.select({ status: templates.status, moderation: templates.moderation }).from(templates).where(eq(templates.slug, slug)))[0]

beforeAll(async () => {
  await resetTables([jobs, templates, users])
  const [m] = await db.insert(users).values({ handle: 'drafts-me' }).returning({ id: users.id })
  const [o] = await db.insert(users).values({ handle: 'drafts-other' }).returning({ id: users.id })
  meId = m.id
  otherId = o.id
})

beforeEach(async () => {
  await db.delete(jobs)
  await db.delete(templates)
})

describe('свои черновики', () => {
  it('видно только своё и только неопубликованное', async () => {
    await draft(meId, 'mine-one')
    await draft(meId, 'mine-two')
    await draft(meId, 'mine-published', { status: 'published' })
    await draft(otherId, 'not-mine')

    const res = await mcpMyDrafts(meId)

    expect(res.total).toBe(2)
    expect(res.drafts.map((d) => d.ref).sort()).toEqual(['drafts-me/mine-one', 'drafts-me/mine-two'])
  })

  it('фильтр по тегу разбирает семейство целиком', async () => {
    await draft(meId, 'a-skill', { tags: ['skill'] })
    await draft(meId, 'a-hook', { tags: ['hook'] })

    expect((await mcpMyDrafts(meId, { tag: 'hook' })).drafts.map((d) => d.ref)).toEqual(['drafts-me/a-hook'])
  })
})

describe('публикация пачкой', () => {
  it('по умолчанию ничего не пишет — это план', async () => {
    await draft(meId, 'plan-me')

    const res = await mcpPublishLists(meId, ['drafts-me/plan-me'])

    expect(res).toMatchObject({ dryRun: true, published: 0 })
    expect((await statusOf('plan-me')).status).toBe('draft')
  })

  it('с dryRun:false публикует', async () => {
    await draft(meId, 'go-live')

    const res = await mcpPublishLists(meId, ['drafts-me/go-live'], false)

    expect(res).toMatchObject({ published: 1 })
    expect((await statusOf('go-live')).status).toBe('published')
  })

  // Главное свойство: барьер живёт в сервисном слое, поэтому второй путь публикации его
  // не обходит. Публичный список после публикации ждёт проверки, а не висит «активным».
  it('публичный список уходит на модерацию, а не в паблик напрямую', async () => {
    await draft(meId, 'needs-check')

    await mcpPublishLists(meId, ['drafts-me/needs-check'], false)

    const row = await statusOf('needs-check')
    expect(row.status).toBe('published')
    expect(row.moderation).toBe('pending')
    const queued = await db.select({ type: jobs.type }).from(jobs)
    expect(queued.map((j) => j.type)).toContain('moderate')
  })

  it('модерация не настроена — список публикуется как есть, без ложного «на проверке»', async () => {
    const ai = await import('@/shared/settings/ai')
    vi.mocked(ai.getApiKey).mockResolvedValueOnce('')
    await draft(meId, 'no-gate')

    await mcpPublishLists(meId, ['drafts-me/no-gate'], false)

    expect((await statusOf('no-gate')).moderation).toBe('active')
  })

  it('снятое модерацией не отмывается повторной публикацией', async () => {
    await draft(meId, 'was-flagged', { moderation: 'flagged' })

    await mcpPublishLists(meId, ['drafts-me/was-flagged'], false)

    expect((await statusOf('was-flagged')).moderation).toBe('flagged')
  })

  it('чужое и уже опубликованное пропускаются с причиной', async () => {
    await draft(otherId, 'foreign')
    await draft(meId, 'already', { status: 'published' })

    const res = await mcpPublishLists(meId, ['drafts-me/foreign', 'drafts-me/already'], false)

    expect(res).toMatchObject({ published: 0, skipped: 2 })
    expect('lists' in res && res.lists.every((l) => l.status === 'skipped' && !!l.reason)).toBe(true)
  })

  it('пачка ограничена — иначе одним вызовом уходит вся библиотека', async () => {
    const refs = Array.from({ length: MCP_PUBLISH_MAX + 1 }, (_, i) => `drafts-me/x-${i}`)
    expect(await mcpPublishLists(meId, refs, false)).toMatchObject({ error: expect.stringContaining('too many') })
  })
})
