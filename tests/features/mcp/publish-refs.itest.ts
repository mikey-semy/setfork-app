import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ПУБЛИКАЦИЯ ПАЧКОЙ: АДРЕС РАЗБИРАЕТСЯ ЦЕЛИКОМ, СПИСОК СЧИТАЕТСЯ ОДИН РАЗ.
 *
 * Три замечания авто-ревью, смерженные непрочитанными (#789, #793):
 *
 * 1. префикс адреса отбрасывался, и `чужой/deploy` публиковал СВОЙ `deploy`, отчитываясь
 *    при этом чужим адресом — ассистент просил одно, получал другое и читал ответ как успех;
 * 2. дедуп шёл по слагу, поэтому прежний адрес того же списка считался вторым списком;
 * 3. план и запись классифицировали снятый модерацией ПРИВАТНЫЙ список по-разному: план
 *    звал его заблокированным, запись публиковала.
 *
 * Плюс переиндексация: опубликованный черновик не попадал в смысловой поиск вовсе.
 */
const { db, jobs, templates, users } = await import('@/shared/db')
const { mcpPublishLists } = await import('@/features/mcp/tools/lists/publish')
const { publishOwnedDrafts } = await import('@/features/library/publish-draft')

let meId = ''
let otherId = ''

const mkList = async (ownerId: string, slug: string, over: Record<string, unknown> = {}) => {
  const [row] = await db
    .insert(templates)
    .values({ ownerId, slug, title: { en: slug }, desc: {}, tags: [], status: 'draft', currentVersion: 1, ...over } as never)
    .returning({ id: templates.id })
  return row.id
}

beforeEach(async () => {
  await resetTables([templates, users, jobs])
  const [me] = await db.insert(users).values({ handle: 'me', email: 'me@x.dev', name: 'Me' }).returning({ id: users.id })
  const [other] = await db.insert(users).values({ handle: 'other', email: 'other@x.dev', name: 'Other' }).returning({ id: users.id })
  meId = me.id
  otherId = other.id
})

describe('publish_lists: адреса', () => {
  it('чужой адрес НЕ публикует одноимённый свой список', async () => {
    const mine = await mkList(meId, 'deploy')
    await mkList(otherId, 'deploy')

    const res = (await mcpPublishLists(meId, ['other/deploy'], false)) as { published: number; skipped: number; lists: { ref: string; status: string }[] }

    expect(res.published).toBe(0)
    expect(res.skipped).toBe(1)
    expect(res.lists[0]).toMatchObject({ ref: 'other/deploy', status: 'skipped' })
    // Свой список остался черновиком — его никто не просил публиковать.
    expect((await db.select({ s: templates.status }).from(templates).where(eq(templates.id, mine)))[0].s).toBe('draft')
  })

  it('два ЧУЖИХ адреса одного списка не выдают, что это один список', async () => {
    // Линза 02: ответ про чужое обязан быть одинаковым — иначе инструмент подтверждает
    // постороннему связь двух адресов, которую тот только предполагал.
    const foreign = await mkList(otherId, 'secretplan')
    await db.update(templates).set({ visibility: 'private' }).where(eq(templates.id, foreign))

    const res = (await mcpPublishLists(meId, ['other/secretplan', 'other/secretplan '], false)) as {
      lists: { ref: string; reason?: string }[]
    }

    for (const l of res.lists) expect(l.reason).not.toMatch(/same list/)
  })

  it('свой адрес с ником публикует', async () => {
    const mine = await mkList(meId, 'deploy')

    const res = (await mcpPublishLists(meId, ['me/deploy'], false)) as { published: number }

    expect(res.published).toBe(1)
    expect((await db.select({ s: templates.status }).from(templates).where(eq(templates.id, mine)))[0].s).toBe('published')
  })

  it('тот же список двумя адресами считается один раз', async () => {
    await mkList(meId, 'deploy')

    const res = (await mcpPublishLists(meId, ['deploy', 'me/deploy'], false)) as { published: number; skipped: number }

    expect(res.published).toBe(1)
    expect(res.skipped).toBe(1)
  })

  it('идущая переиндексация не глотает постановку после публикации', async () => {
    // Джоба, взятая в работу, читала список ЧЕРНОВИКОМ и запишет пустоту приватного.
    // Считать её дублем — значит оставить опубликованный список вне смыслового поиска до
    // первой посторонней правки (находка авто-ревью по #819).
    const id = await mkList(meId, 'inflight')
    await db.insert(jobs).values({ type: 'reindex', status: 'processing', payload: { templateId: id } } as never)

    await mcpPublishLists(meId, ['inflight'], false)

    const queued = await db.select({ type: jobs.type, status: jobs.status }).from(jobs)
    expect(queued.filter((j) => j.type === 'reindex' && j.status === 'pending')).toHaveLength(1)
  })

  it('опубликованный черновик уходит в переиндексацию', async () => {
    await mkList(meId, 'deploy')

    await mcpPublishLists(meId, ['deploy'], false)

    // Смысловой поиск ходит через таблицу эмбеддингов, а её наполняет очередь.
    const queued = await db.select({ type: jobs.type }).from(jobs)
    expect(queued.map((j) => j.type)).toContain('reindex')
  })
})

/**
 * План считается ТЕМИ ЖЕ счётчиками, что и запись. Проверяем на общем слое: именно его
 * числа читает диалог подтверждения, и именно они расходились — по статусу в ответе MCP
 * расхождение не видно вовсе (первая версия этой проверки была пустой, показала мутация).
 */
describe('план обещает то же, что запись', () => {
  it('приватный снятый модерацией: и в плане, и в записи — опубликован', async () => {
    const id = await mkList(meId, 'secret', { visibility: 'private', moderation: 'flagged' })

    const plan = await publishOwnedDrafts(meId, [id], { dryRun: true })
    expect({ blocked: plan.blocked, published: plan.published }).toEqual({ blocked: 0, published: 1 })

    const done = await publishOwnedDrafts(meId, [id], { dryRun: false })
    expect({ blocked: done.blocked, published: done.published }).toEqual({ blocked: 0, published: 1 })
  })

  it('ПУБЛИЧНЫЙ снятый модерацией остаётся заблокированным в обоих', async () => {
    const id = await mkList(meId, 'shamed', { visibility: 'public', moderation: 'flagged' })

    const plan = await publishOwnedDrafts(meId, [id], { dryRun: true })
    const done = await publishOwnedDrafts(meId, [id], { dryRun: false })

    expect(plan.blocked).toBe(1)
    expect(done.blocked).toBe(1)
  })
})
