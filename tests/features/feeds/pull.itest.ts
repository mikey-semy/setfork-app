import { eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Петля сбора потока на РЕАЛЬНОЙ БД. Сеть замокана: проверяем не интернет, а поведение —
// дедуп между лентами, отметку использованного, отбор по домену и то, что мёртвый источник
// не роняет проход, а оставляет причину в last_error (иначе один упавший источник останавливал
// бы все, и владелец не узнал бы почему).
const fetchMock = vi.hoisted(() => ({ body: '', ok: true, status: 200, fail: false }))
vi.mock('@/shared/lib/safe-fetch', () => ({
  fetchPublicUrl: vi.fn(async () => {
    if (fetchMock.fail) return null
    return { ok: fetchMock.ok, status: fetchMock.status, text: async () => fetchMock.body } as unknown as Response
  }),
}))

const { agentActions, db, feedItems, feedSources, templates, users } = await import('@/shared/db')
const { freshForDomains, markUsed, pullSource, runFeedPullSweep } = await import('@/features/feeds/service')

const rss = (items: { t: string; u: string }[]) =>
  `<rss><channel>${items.map((i) => `<item><title>${i.t}</title><link>${i.u}</link><pubDate>Mon, 27 Jul 2026 09:00:00 +0000</pubDate><description>кратко</description></item>`).join('')}</channel></rss>`

let userId = ''

const addSource = async (url: string, tags: string[], over: Partial<typeof feedSources.$inferInsert> = {}) => {
  const [row] = await db.insert(feedSources).values({ url, tags, addedBy: userId, ...over }).returning()
  return row
}

beforeAll(async () => {
  await db.execute(sql`truncate table ${feedItems}, ${feedSources}, ${agentActions}, ${templates}, ${users} restart identity cascade`)
  const [u] = await db.insert(users).values({ handle: 'feed-owner' }).returning({ id: users.id })
  userId = u.id
})

beforeEach(async () => {
  await db.delete(feedItems)
  await db.delete(feedSources)
  await db.delete(agentActions)
  fetchMock.fail = false
  fetchMock.ok = true
  fetchMock.status = 200
})

describe('сбор одной подписки', () => {
  it('кладёт элементы и отмечает время; тело статей не хранится', async () => {
    const src = await addSource('https://a.example/rss', ['devops'])
    fetchMock.body = rss([{ t: 'Postgres 19', u: 'https://a.example/pg19' }])
    const res = await pullSource(src)
    expect(res).toMatchObject({ fetched: 1, fresh: 1, error: '' })

    const [row] = await db.select().from(feedItems)
    expect(row.title).toBe('Postgres 19')
    expect(row.hint).toBe('кратко') // подсказка для отбора
    expect(row.tags).toEqual(['devops']) // тема наследуется от подписки
    expect(Object.keys(row)).not.toContain('body') // тела статьи в схеме нет вовсе

    const [after] = await db.select().from(feedSources).where(eq(feedSources.id, src.id))
    expect(after.lastPulledAt).not.toBeNull()
    expect(after.lastItems).toBe(1)
    expect(after.lastError).toBe('')
  })

  it('повторный сбор той же ленты новых элементов не добавляет', async () => {
    const src = await addSource('https://a.example/rss', ['devops'])
    fetchMock.body = rss([{ t: 'Postgres 19', u: 'https://a.example/pg19' }])
    await pullSource(src)
    const second = await pullSource(src)
    expect(second).toMatchObject({ fetched: 1, fresh: 0 })
    expect(await db.select().from(feedItems)).toHaveLength(1)
  })

  it('один материал в ДВУХ лентах с разными utm — одна новость, а не две', async () => {
    const a = await addSource('https://a.example/rss', ['devops'])
    const b = await addSource('https://b.example/rss', ['devops'])
    fetchMock.body = rss([{ t: 'Одно и то же', u: 'https://src.example/x?utm_source=a' }])
    await pullSource(a)
    fetchMock.body = rss([{ t: 'Одно и то же', u: 'https://src.example/x?utm_source=b' }])
    const second = await pullSource(b)
    expect(second.fresh).toBe(0)
    expect(await db.select().from(feedItems)).toHaveLength(1)
  })

  it('недоступный источник: причина в last_error, проход не падает', async () => {
    const src = await addSource('https://dead.example/rss', ['devops'])
    fetchMock.fail = true
    const res = await pullSource(src)
    expect(res.fetched).toBe(0)
    expect(res.error).toContain('недоступен')
    const [after] = await db.select().from(feedSources).where(eq(feedSources.id, src.id))
    expect(after.lastError).toContain('недоступен')
    expect(after.lastPulledAt).not.toBeNull() // попытка зафиксирована, иначе будем биться каждый проход
  })

  it('ответ с ошибкой (500) тоже попадает в причину', async () => {
    const src = await addSource('https://err.example/rss', ['devops'])
    fetchMock.ok = false
    fetchMock.status = 500
    expect((await pullSource(src)).error).toContain('500')
  })
})

describe('проход петли', () => {
  it('берёт только те подписки, которым пора', async () => {
    await addSource('https://due.example/rss', ['devops'], { lastPulledAt: new Date(Date.now() - 10 * 3600_000), everyHours: 6 })
    await addSource('https://fresh.example/rss', ['devops'], { lastPulledAt: new Date(), everyHours: 6 })
    fetchMock.body = rss([{ t: 'Новость', u: 'https://due.example/1' }])
    const res = await runFeedPullSweep()
    expect(res.sources).toBe(1)
    expect(res.fresh).toBe(1)
  })

  it('выключенная подписка не тянется', async () => {
    await addSource('https://off.example/rss', ['devops'], { enabled: false })
    expect((await runFeedPullSweep()).sources).toBe(0)
  })

  it('каждая попытка пишется в журнал — сбор виден в «Дне компании»', async () => {
    await addSource('https://a.example/rss', ['devops'])
    fetchMock.body = rss([{ t: 'Новость', u: 'https://a.example/1' }])
    await runFeedPullSweep()
    const [row] = await db.select().from(agentActions)
    expect(row).toMatchObject({ loop: 'feedpull', action: 'feed.pull', resultStatus: 'ok' })
  })
})

describe('материал для специалиста', () => {
  it('отдаёт свежее по его темам и не отдаёт использованное', async () => {
    const src = await addSource('https://a.example/rss', ['кулинария'])
    fetchMock.body = rss([
      { t: 'Сезонные овощи', u: 'https://a.example/veg' },
      { t: 'Хлебные тренды', u: 'https://a.example/bread' },
    ])
    await pullSource(src)

    const fresh = await freshForDomains(['кулинария'])
    expect(fresh).toHaveLength(2)

    await markUsed([fresh[0].id], null)
    expect(await freshForDomains(['кулинария'])).toHaveLength(1)
  })

  it('чужая тема не отдаётся', async () => {
    const src = await addSource('https://a.example/rss', ['devops'])
    fetchMock.body = rss([{ t: 'Про деплой', u: 'https://a.example/deploy' }])
    await pullSource(src)
    expect(await freshForDomains(['кулинария'])).toHaveLength(0)
  })

  it('универсал («*») материала не получает — лента растёт вглубь темы', async () => {
    expect(await freshForDomains(['*'])).toEqual([])
  })
})
