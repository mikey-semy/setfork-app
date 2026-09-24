import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { resetTables } from '../../helpers/reset-db'

/**
 * INDEXNOW — ПРОХОД НА НАСТОЯЩЕЙ БАЗЕ.
 *
 * Подменена только сеть (`send`): до api.indexnow.org тесты не достают. Всё остальное —
 * настоящее: правило индексации, адреса по языкам, пометки отправленного, отступ.
 */
const { db, agentActions, agentLoops, appSettings, indexnowSubmissions, jobs, templates, users } = await import('@/shared/db')
const { runIndexNowPass, ensureIndexNowScheduled, listUrls, MAX_URLS_PER_REQUEST, INDEXNOW_KEYS } = await import('@/features/library/indexnow')
type Body = Parameters<Parameters<typeof runIndexNowPass>[0] & object>[0]

const KEY = 'test-key-1234'
const ORIGIN = 'https://example.org'
let owner = ''

/** Поддельная отправка: помнит тела, отвечает заданным кодом. */
function fakeSend(status = 200) {
  const bodies: Body[] = []
  const send = async (b: Body) => {
    bodies.push(b)
    return status
  }
  return { bodies, send, urls: () => bodies.flatMap((b) => b.urlList) }
}

type Shape = { status?: 'draft' | 'published'; visibility?: 'public' | 'private'; moderation?: 'active' | 'hidden' | 'pending' }
async function list(slug: string, shape: Shape = {}) {
  const [t] = await db
    .insert(templates)
    .values({ ownerId: owner, slug, title: { en: slug }, status: shape.status ?? 'published', visibility: shape.visibility ?? 'public', moderation: shape.moderation ?? 'active', currentVersion: 1 })
    .returning({ id: templates.id })
  return t.id
}

beforeAll(() => {
  vi.stubEnv('INDEXNOW_KEY', KEY)
  // Адреса — от appOrigin(), а он читает APP_URL: ни одного запроса в проходе нет.
  vi.stubEnv('APP_URL', ORIGIN)
})
afterAll(() => vi.unstubAllEnvs())

beforeEach(async () => {
  await resetTables([agentActions, agentLoops, appSettings, indexnowSubmissions, jobs, templates, users])
  const [u] = await db.insert(users).values({ handle: 'alice' }).returning({ id: users.id })
  owner = u.id
})

describe('что уходит поисковикам', () => {
  it('только индексируемое: черновик, приватный и скрытые модерацией — никогда', async () => {
    await list('public-one')
    await list('draft-one', { status: 'draft' })
    await list('private-one', { visibility: 'private' })
    await list('hidden-one', { moderation: 'hidden' })
    await list('pending-one', { moderation: 'pending' })
    const f = fakeSend()
    await runIndexNowPass(f.send)
    const all = f.urls().join('\n')
    expect(all).toContain('/alice/public-one')
    // Адрес раскрывает слаг — поэтому проверяется сам слаг, а не только число адресов.
    for (const slug of ['draft-one', 'private-one', 'hidden-one', 'pending-one']) expect(all, slug).not.toContain(slug)
  })

  it('все языковые адреса и адрес без префикса', async () => {
    await list('deploy')
    const f = fakeSend()
    await runIndexNowPass(f.send)
    expect(f.urls().sort()).toEqual([`${ORIGIN}/alice/deploy`, `${ORIGIN}/en/alice/deploy`, `${ORIGIN}/ru/alice/deploy`])
    expect(f.urls().sort()).toEqual(listUrls('alice', 'deploy', ORIGIN).sort())
  })

  it('хост, адреса и файл ключа — от appOrigin(), не от запроса', async () => {
    await list('deploy')
    const f = fakeSend()
    await runIndexNowPass(f.send)
    expect(f.bodies[0]).toMatchObject({ host: 'example.org', key: KEY, keyLocation: `${ORIGIN}/${KEY}.txt` })
    for (const u of f.urls()) expect(new URL(u).host).toBe('example.org')
  })
})

describe('пометки отправленного честные', () => {
  it.each([200, 202])('%i — отмечено: следующий проход не шлёт то же', async (code) => {
    await list('deploy')
    expect((await runIndexNowPass(fakeSend(code).send)).sentLists).toBe(1)
    const again = fakeSend()
    await runIndexNowPass(again.send)
    // Пусто: отправленное не уходит повторно (в том числе из-за микросекунд updated_at).
    expect(again.bodies).toHaveLength(0)
  })

  it.each([429, 500, 503, 0])('%i — не отмечено: следующий проход повторит', async (code) => {
    await list('deploy')
    expect(await runIndexNowPass(fakeSend(code).send)).toMatchObject({ status: 'retry', sentLists: 0 })
    const again = fakeSend()
    await runIndexNowPass(again.send)
    expect(again.urls()).toContain(`${ORIGIN}/alice/deploy`)
  })

  it.each([400, 403, 422])('%i — не отмечено, запись в журнал, отступ: приёмник не долбим', async (code) => {
    await list('deploy')
    const now = new Date()
    expect(await runIndexNowPass(fakeSend(code).send, now)).toMatchObject({ status: 'config-error', sentLists: 0 })
    const [act] = await db.select().from(agentActions).where(eq(agentActions.loop, 'indexnow'))
    expect(act).toMatchObject({ action: 'indexnow.submit', resultStatus: 'error' })
    // Через 15 минут — молчит.
    const soon = fakeSend()
    expect(await runIndexNowPass(soon.send, new Date(now.getTime() + 15 * 60_000))).toMatchObject({ status: 'backoff' })
    expect(soon.bodies).toHaveLength(0)
    // После отступа — повторяет неотмеченное.
    const later = fakeSend()
    await runIndexNowPass(later.send, new Date(now.getTime() + 7 * 3_600_000))
    expect(later.urls()).toContain(`${ORIGIN}/alice/deploy`)
  })

  it('правка после отправки — уходит снова', async () => {
    const id = await list('deploy')
    await runIndexNowPass(fakeSend().send)
    await db.update(templates).set({ updatedAt: new Date(Date.now() + 1000) }).where(eq(templates.id, id))
    const again = fakeSend()
    await runIndexNowPass(again.send)
    expect(again.urls()).toContain(`${ORIGIN}/alice/deploy`)
  })

  it('правка, пришедшая ПОКА пачка летела, не теряется', async () => {
    // Пометка — `updated_at` на момент чтения, а не время отправки: иначе правка между
    // чтением и ответом поисковика оказалась бы «старше» пометки и не ушла бы никогда.
    const id = await list('deploy')
    await runIndexNowPass(async () => {
      await db.update(templates).set({ updatedAt: new Date() }).where(eq(templates.id, id))
      return 200
    })
    const again = fakeSend()
    await runIndexNowPass(again.send)
    expect(again.urls()).toContain(`${ORIGIN}/alice/deploy`)
  })

  it('стал публичным БЕЗ правки (видимость, одобрение модерации) — тоже уходит', async () => {
    // Оба пути не двигают updated_at: с одной отметкой по времени правки такие списки
    // остались бы позади неё навсегда.
    const priv = await list('was-private', { visibility: 'private' })
    const held = await list('was-held', { moderation: 'pending' })
    await list('other')
    await runIndexNowPass(fakeSend().send)
    const before = await db.select({ updatedAt: templates.updatedAt }).from(templates).where(inArray(templates.id, [priv, held]))
    await db.update(templates).set({ visibility: 'public' }).where(eq(templates.id, priv))
    await db.update(templates).set({ moderation: 'active' }).where(eq(templates.id, held))
    const after = await db.select({ updatedAt: templates.updatedAt }).from(templates).where(inArray(templates.id, [priv, held]))
    expect(after).toEqual(before) // updated_at действительно не сдвинулся
    const again = fakeSend()
    await runIndexNowPass(again.send)
    expect(again.urls()).toEqual(expect.arrayContaining([`${ORIGIN}/alice/was-private`, `${ORIGIN}/alice/was-held`]))
    expect(again.urls().join('\n')).not.toContain('/alice/other')
  })
})

describe('журнал петли', () => {
  it('пустой проход не пишется: на тихом сайте петля не выглядит холостой', async () => {
    for (let i = 0; i < 3; i++) await runIndexNowPass(fakeSend().send)
    expect(await db.select().from(agentActions).where(eq(agentActions.loop, 'indexnow'))).toHaveLength(0)
    const { stallReport } = await import('@/shared/agents/stall')
    expect((await stallReport('indexnow')).stalled).toBe(false)
  })

  it('принятая пачка — прогресс петли', async () => {
    await list('deploy')
    await runIndexNowPass(fakeSend().send)
    const [act] = await db.select().from(agentActions).where(eq(agentActions.loop, 'indexnow'))
    expect(act).toMatchObject({ action: 'indexnow.submit', resultStatus: 'ok' })
    const { stallReport } = await import('@/shared/agents/stall')
    expect((await stallReport('indexnow')).progress).toBe(1)
  })
})

describe('пачки', () => {
  it('адресов больше потолка протокола — два запроса, каждый не больше потолка', async () => {
    const perList = listUrls('h', 's', ORIGIN).length
    const lists = Math.floor(MAX_URLS_PER_REQUEST / perList) + 1
    await db.insert(templates).values(
      Array.from({ length: lists }, (_, i) => ({ ownerId: owner, slug: `bulk-${i}`, title: { en: `b${i}` }, status: 'published' as const, visibility: 'public' as const, currentVersion: 1 })),
    )
    const f = fakeSend()
    const r = await runIndexNowPass(f.send)
    expect(lists * perList).toBeGreaterThan(MAX_URLS_PER_REQUEST)
    expect(f.bodies).toHaveLength(2)
    for (const b of f.bodies) expect(b.urlList.length).toBeLessThanOrEqual(MAX_URLS_PER_REQUEST)
    expect(r.sentLists).toBe(lists)
    expect(new Set(f.urls()).size).toBe(lists * perList)
  })
})

describe('выключено без ключа', () => {
  it('проход ничего не отправляет и даже не читает списки', async () => {
    vi.stubEnv('INDEXNOW_KEY', '')
    try {
      await list('deploy')
      const f = fakeSend()
      expect(await runIndexNowPass(f.send)).toMatchObject({ status: 'off' })
      expect(f.bodies).toHaveLength(0)
      expect(await db.select().from(indexnowSubmissions)).toHaveLength(0)
    } finally {
      vi.stubEnv('INDEXNOW_KEY', KEY)
    }
  })

  it('задача в очереди одна, повтор планировщика не плодит вторую', async () => {
    await ensureIndexNowScheduled()
    await ensureIndexNowScheduled()
    expect(await db.select().from(jobs).where(eq(jobs.type, 'indexnow'))).toHaveLength(1)
  })

  it('отступ хранится в настройках', async () => {
    await list('deploy')
    await runIndexNowPass(fakeSend(403).send)
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, INDEXNOW_KEYS.backoffUntil))
    expect(new Date(row.value).getTime()).toBeGreaterThan(Date.now())
  })
})
