import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { resetTables } from '../../helpers/reset-db'

/**
 * INDEXNOW — ПРОХОД НА НАСТОЯЩЕЙ БАЗЕ.
 *
 * Подменена только сеть: отправка пачки (`send`) и проверка своего файла ключа
 * (`checkKey`) — до api.indexnow.org и до публичного адреса тесты не достают. Всё
 * остальное настоящее: правило индексации, адреса по языкам, пометки, отступы, журнал.
 */
const { db, agentActions, agentLoops, appSettings, indexnowSubmissions, jobs, templates, users } = await import('@/shared/db')
const { runIndexNowPass, ensureIndexNowScheduled, listUrls, INDEXNOW_KEYS } = await import('@/features/library/indexnow')
type Body = Parameters<Parameters<typeof runIndexNowPass>[0] & object>[0]
type Send = (b: Body) => Promise<number>

const KEY = 'test-key-1234'
const ORIGIN = 'https://example.org'
/** Адрес страницы — один на все языки (ADR-0029). */
const url = (path: string) => [`${ORIGIN}${path}`]
let owner = ''

/** Файл ключа на месте — как у живого сайта с верным APP_URL. */
const keyOk = async () => true
/** Проход с проверкой ключа без сети. */
const pass = (send: Send, now?: Date, checkKey: () => Promise<boolean | null> = keyOk) => runIndexNowPass(send, now, checkKey)
/**
 * Потолок пачки для тестов пачек. Протокольный (десять тысяч адресов) потребовал бы
 * десяти тысяч списков на тест и не укладывался в таймаут CI; правило то же, объём мал.
 * Нечётный: переехавший список несёт два адреса, и при чётном потолке пачка заполнялась
 * ровно — перебор на один адрес тест не видел (проверено мутацией).
 */
const CAP = 13
const passCapped = (send: Send) => runIndexNowPass(send, undefined, keyOk, CAP)

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
const journal = () => db.select().from(agentActions).where(eq(agentActions.loop, 'indexnow'))

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
    await pass(f.send)
    const all = f.urls().join('\n')
    expect(all).toContain('/alice/public-one')
    // Адрес раскрывает слаг — поэтому проверяется сам слаг, а не только число адресов.
    for (const slug of ['draft-one', 'private-one', 'hidden-one', 'pending-one']) expect(all, slug).not.toContain(slug)
  })

  it('все языковые адреса и адрес без префикса', async () => {
    await list('deploy')
    const f = fakeSend()
    await pass(f.send)
    expect(f.urls().sort()).toEqual(url('/alice/deploy').sort())
    expect(f.urls().sort()).toEqual(listUrls('alice', 'deploy', ORIGIN).sort())
  })

  it('хост, адреса и файл ключа — от appOrigin(), не от запроса', async () => {
    await list('deploy')
    const f = fakeSend()
    await pass(f.send)
    expect(f.bodies[0]).toMatchObject({ host: 'example.org', key: KEY, keyLocation: `${ORIGIN}/${KEY}.txt` })
    for (const u of f.urls()) expect(new URL(u).host).toBe('example.org')
  })
})

describe('пометки отправленного честные', () => {
  it.each([200, 202])('%i — отмечено: следующий проход не шлёт то же', async (code) => {
    await list('deploy')
    expect((await pass(fakeSend(code).send)).sentLists).toBe(1)
    const again = fakeSend()
    await pass(again.send)
    // Пусто: отправленное не уходит повторно (в том числе из-за микросекунд updated_at).
    expect(again.bodies).toHaveLength(0)
  })

  it.each([500, 503, 0])('%i — не отмечено, ошибка в журнале, следующий проход повторит', async (code) => {
    await list('deploy')
    expect(await pass(fakeSend(code).send)).toMatchObject({ status: 'retry', sentLists: 0 })
    expect(await journal()).toEqual([expect.objectContaining({ action: 'indexnow.submit', resultStatus: 'error' })])
    const again = fakeSend()
    await pass(again.send)
    expect(again.urls()).toContain(`${ORIGIN}/alice/deploy`)
  })

  it('429 — не отмечено и час тишины: «potential spam» повтором не подтверждаем', async () => {
    await list('deploy')
    const now = new Date()
    expect(await pass(fakeSend(429).send, now)).toMatchObject({ status: 'retry', sentLists: 0 })
    const soon = fakeSend()
    expect(await pass(soon.send, new Date(now.getTime() + 15 * 60_000))).toMatchObject({ status: 'backoff' })
    expect(soon.bodies).toHaveLength(0)
    const later = fakeSend()
    await pass(later.send, new Date(now.getTime() + 61 * 60_000))
    expect(later.urls()).toContain(`${ORIGIN}/alice/deploy`)
  })

  it.each([400, 403, 422])('%i — не отмечено, запись в журнал, отступ: приёмник не долбим', async (code) => {
    await list('deploy')
    const now = new Date()
    expect(await pass(fakeSend(code).send, now)).toMatchObject({ status: 'config-error', sentLists: 0 })
    expect(await journal()).toEqual([expect.objectContaining({ action: 'indexnow.submit', resultStatus: 'error' })])
    const soon = fakeSend()
    expect(await pass(soon.send, new Date(now.getTime() + 15 * 60_000))).toMatchObject({ status: 'backoff' })
    expect(soon.bodies).toHaveLength(0)
    const later = fakeSend()
    await pass(later.send, new Date(now.getTime() + 7 * 3_600_000))
    expect(later.urls()).toContain(`${ORIGIN}/alice/deploy`)
    // Отступ хранится в настройках — его видно и можно снять.
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, INDEXNOW_KEYS.backoffUntil))
    expect(row).toBeTruthy()
  })

  it('правка после отправки — уходит снова', async () => {
    const id = await list('deploy')
    await pass(fakeSend().send)
    await db.update(templates).set({ updatedAt: new Date(Date.now() + 1000) }).where(eq(templates.id, id))
    const again = fakeSend()
    await pass(again.send)
    expect(again.urls()).toContain(`${ORIGIN}/alice/deploy`)
  })

  it('правка, пришедшая ПОКА пачка летела, не теряется', async () => {
    // Пометка — `updated_at` на момент чтения, а не время отправки: иначе правка между
    // чтением и ответом поисковика оказалась бы «старше» пометки и не ушла бы никогда.
    const id = await list('deploy')
    await pass(async () => {
      await db.update(templates).set({ updatedAt: new Date() }).where(eq(templates.id, id))
      return 200
    })
    const again = fakeSend()
    await pass(again.send)
    expect(again.urls()).toContain(`${ORIGIN}/alice/deploy`)
  })
})

describe('пути, которые не двигают updated_at', () => {
  it('стал публичным без правки (видимость, одобрение модерации) — уходит', async () => {
    const priv = await list('was-private', { visibility: 'private' })
    const held = await list('was-held', { moderation: 'pending' })
    await list('other')
    await pass(fakeSend().send)
    const before = await db.select({ updatedAt: templates.updatedAt }).from(templates).where(inArray(templates.id, [priv, held]))
    await db.update(templates).set({ visibility: 'public' }).where(eq(templates.id, priv))
    await db.update(templates).set({ moderation: 'active' }).where(eq(templates.id, held))
    const after = await db.select({ updatedAt: templates.updatedAt }).from(templates).where(inArray(templates.id, [priv, held]))
    expect(after).toEqual(before) // updated_at действительно не сдвинулся
    const again = fakeSend()
    await pass(again.send)
    expect(again.urls()).toEqual(expect.arrayContaining([`${ORIGIN}/alice/was-private`, `${ORIGIN}/alice/was-held`]))
    expect(again.urls().join('\n')).not.toContain('/alice/other')
  })

  it('смена ника — уходят новые адреса и старые (там теперь 301)', async () => {
    await list('deploy')
    await pass(fakeSend().send)
    await db.update(users).set({ handle: 'alice-new' }).where(eq(users.id, owner))
    const again = fakeSend()
    await pass(again.send)
    expect(again.urls().sort()).toEqual([...url('/alice-new/deploy'), ...url('/alice/deploy')].sort())
    // И больше не повторяется.
    const third = fakeSend()
    await pass(third.send)
    expect(third.bodies).toHaveLength(0)
  })

  it('список перешёл к другому владельцу (передача, «призрак» удалённого аккаунта) — уходит', async () => {
    const id = await list('deploy')
    await pass(fakeSend().send)
    const [ghost] = await db.insert(users).values({ handle: 'ghost' }).returning({ id: users.id })
    await db.update(templates).set({ ownerId: ghost.id }).where(eq(templates.id, id))
    const again = fakeSend()
    await pass(again.send)
    expect(again.urls()).toEqual(expect.arrayContaining(url('/ghost/deploy')))
  })

  it('⚠️ отправлено с языковыми адресами (22–25.09) — один раз уходят адрес и прежние `/ru/`, `/en/`', async () => {
    const id = await list('deploy')
    await pass(fakeSend().send)
    // Так выглядит строка, отправленная до ADR-0029: адреса на обоих языках.
    await db.update(indexnowSubmissions).set({ sentLangs: 'en,ru' }).where(eq(indexnowSubmissions.templateId, id))
    const again = fakeSend()
    await pass(again.send)
    // Прежние языковые адреса теперь отвечают 308 — поисковик должен об этом узнать.
    expect(again.urls().sort()).toEqual([`${ORIGIN}/alice/deploy`, `${ORIGIN}/en/alice/deploy`, `${ORIGIN}/ru/alice/deploy`].sort())
    const [row] = await db.select().from(indexnowSubmissions).where(eq(indexnowSubmissions.templateId, id))
    expect(row.sentLangs).toBe('')
    const third = fakeSend()
    await pass(third.send)
    expect(third.bodies).toHaveLength(0)
  })

  it('снят с публичности — сообщается (протокол велит сообщать об удалённом); открыт снова — уходит снова', async () => {
    const id = await list('deploy')
    await pass(fakeSend().send)
    await db.update(templates).set({ visibility: 'private' }).where(eq(templates.id, id))
    const withdraw = fakeSend()
    expect(await pass(withdraw.send)).toMatchObject({ withdrawnLists: 1, sentLists: 0 })
    // Те же адреса, что уже были публичными: ничего нового они не раскрывают.
    expect(withdraw.urls().sort()).toEqual(url('/alice/deploy').sort())
    expect(await db.select().from(indexnowSubmissions)).toHaveLength(0)
    // Второй раз о снятии не сообщается.
    const quiet = fakeSend()
    await pass(quiet.send)
    expect(quiet.bodies).toHaveLength(0)
    // Открыли снова без правки — уходит.
    await db.update(templates).set({ visibility: 'public' }).where(eq(templates.id, id))
    const reopened = fakeSend()
    await pass(reopened.send)
    expect(reopened.urls()).toContain(`${ORIGIN}/alice/deploy`)
  })

  it('никогда не отправленный и закрытый — не сообщается вовсе', async () => {
    await list('secret', { visibility: 'private' })
    const f = fakeSend()
    await pass(f.send)
    expect(f.bodies).toHaveLength(0)
  })
})

describe('файл ключа и предохранители', () => {
  it('свой файл ключа не отдаётся (неверный APP_URL, 301) — не шлём, отступ, ошибка в журнале', async () => {
    await list('deploy')
    const f = fakeSend()
    expect(await pass(f.send, new Date(), async () => false)).toMatchObject({ status: 'config-error' })
    expect(f.bodies).toHaveLength(0)
    expect(await journal()).toEqual([expect.objectContaining({ resultStatus: 'error' })])
  })

  it('проверить свой ключ не удалось (сеть до самих себя) — отправка идёт', async () => {
    await list('deploy')
    const f = fakeSend()
    await pass(f.send, new Date(), async () => null)
    expect(f.urls()).toContain(`${ORIGIN}/alice/deploy`)
  })

  it('пять ошибок подряд — предохранитель: шестой проход не шлёт ничего', async () => {
    await list('deploy')
    for (let i = 0; i < 5; i++) await pass(fakeSend(500).send)
    const f = fakeSend()
    expect(await pass(f.send)).toMatchObject({ status: 'tripped' })
    expect(f.bodies).toHaveLength(0)
    const [pol] = await db.select().from(agentLoops).where(eq(agentLoops.type, 'indexnow'))
    expect(pol?.circuitTrippedAt).toBeTruthy()
  })

  it('ключ задан, но не по правилам протокола — не молчим: ошибка в журнале', async () => {
    vi.stubEnv('INDEXNOW_KEY', 'with_underscore_key')
    try {
      await list('deploy')
      const f = fakeSend()
      expect(await pass(f.send)).toMatchObject({ status: 'off' })
      expect(f.bodies).toHaveLength(0)
      expect(await journal()).toEqual([expect.objectContaining({ resultStatus: 'error', error: 'INDEXNOW_KEY is invalid' })])
    } finally {
      vi.stubEnv('INDEXNOW_KEY', KEY)
    }
  })

  it('ключа нет — проход ничего не делает и в журнал не пишет', async () => {
    vi.stubEnv('INDEXNOW_KEY', '')
    try {
      await list('deploy')
      const f = fakeSend()
      expect(await pass(f.send)).toMatchObject({ status: 'off' })
      expect(f.bodies).toHaveLength(0)
      expect(await db.select().from(indexnowSubmissions)).toHaveLength(0)
      expect(await journal()).toHaveLength(0)
    } finally {
      vi.stubEnv('INDEXNOW_KEY', KEY)
    }
  })
})

describe('журнал петли', () => {
  it('пустой проход не пишется: запись `skipped` каждые 15 минут залила бы окно детектора', async () => {
    for (let i = 0; i < 3; i++) await pass(fakeSend().send)
    expect(await journal()).toHaveLength(0)
  })

  it('принятая пачка — прогресс петли', async () => {
    await list('deploy')
    await pass(fakeSend().send)
    expect(await journal()).toEqual([expect.objectContaining({ action: 'indexnow.submit', resultStatus: 'ok' })])
    const { stallReport } = await import('@/shared/agents/stall')
    expect((await stallReport('indexnow')).progress).toBe(1)
  })
})

describe('пачки', () => {
  it('одна пачка за проход, не больше потолка; остаток — следующим проходом', async () => {
    const perList = listUrls('h', 's', ORIGIN).length
    const lists = Math.floor(CAP / perList) + 1
    await db.insert(templates).values(
      Array.from({ length: lists }, (_, i) => ({ ownerId: owner, slug: `bulk-${i}`, title: { en: `b${i}` }, status: 'published' as const, visibility: 'public' as const, currentVersion: 1 })),
    )
    expect(lists * perList).toBeGreaterThan(CAP)
    const first = fakeSend()
    await passCapped(first.send)
    expect(first.bodies).toHaveLength(1)
    expect(first.bodies[0].urlList.length).toBeLessThanOrEqual(CAP)
    const second = fakeSend()
    await passCapped(second.send)
    expect(second.bodies).toHaveLength(1)
    expect(new Set([...first.urls(), ...second.urls()]).size).toBe(lists * perList)
    const third = fakeSend()
    await passCapped(third.send)
    expect(third.bodies).toHaveLength(0)
  })
})

describe('пачки с переехавшими', () => {
  it('смена ника у многих списков — у каждого вдвое больше адресов, а пачка всё равно не больше потолка', async () => {
    // Выборка ограничена числом списков под обычный размер; переехавший несёт ещё и старые
    // адреса. Потолок держит сборка пачки, а не лимит выборки, — проверяем именно её.
    const perList = listUrls('h', 's', ORIGIN).length
    const lists = Math.floor(CAP / perList) + 1
    await db.insert(templates).values(
      Array.from({ length: lists }, (_, i) => ({ ownerId: owner, slug: `bulk-${i}`, title: { en: `b${i}` }, status: 'published' as const, visibility: 'public' as const, currentVersion: 1 })),
    )
    await passCapped(fakeSend().send)
    await passCapped(fakeSend().send)
    await db.update(users).set({ handle: 'alice-new' }).where(eq(users.id, owner))
    const moved = fakeSend()
    await passCapped(moved.send)
    expect(moved.bodies).toHaveLength(1)
    expect(moved.bodies[0].urlList.length).toBeLessThanOrEqual(CAP)
    // Влезло максимум: следующий переехавший уже не помещается.
    expect(moved.bodies[0].urlList.length).toBeGreaterThan(CAP - 2 * perList)
  })
})

describe('очередь', () => {
  it('задача в очереди одна, повтор планировщика не плодит вторую', async () => {
    await ensureIndexNowScheduled()
    await ensureIndexNowScheduled()
    expect(await db.select().from(jobs).where(eq(jobs.type, 'indexnow'))).toHaveLength(1)
  })
})
