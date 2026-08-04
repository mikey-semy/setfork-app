import { sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Две границы одного правила «ответ протокола не врёт про запись»:
//
// 1. До приёма пака сбой ядра обязан стать понятным git-отказом, а не 500
//    фреймворка с HTML внутри (карточка 007);
// 2. ПОСЛЕ приёма пака ошибка любого эффекта доставки не имеет права превратить
//    успешную запись в неуспешный `git push` — иначе клиент пушит снова, а версия
//    уже создана (карточка 002).
const h = vi.hoisted(() => ({
  auth: null as null | { userId: string; scope: 'read' | 'write' },
  // Что бросает ядро на каждой операции (null — работает штатно).
  coreThrows: null as null | Error,
  // Что бросает чтение наблюдателей — эффект ПОСЛЕ принятого пака.
  watchersThrow: false,
  newVersion: null as number | null,
  captured: [] as { where: unknown; op?: unknown }[],
  calls: { receive: 0 },
}))

vi.mock('@/shared/auth/api-token', () => ({ verifyApiToken: async () => h.auth }))
vi.mock('@/shared/observability', () => ({
  captureError: (_e: unknown, ctx: Record<string, unknown>) => {
    h.captured.push(ctx as { where: unknown; op?: unknown })
  },
}))
vi.mock('@/features/watch/queries', () => ({
  getWatcherIds: async () => {
    if (h.watchersThrow) throw new Error('watchers lookup failed')
    return []
  },
}))
vi.mock('@/features/git/core', () => ({
  gitCore: {
    infoRefsUploadPack: async () => {
      if (h.coreThrows) throw h.coreThrows
      return Buffer.from('refs')
    },
    infoRefsReceivePack: async () => {
      if (h.coreThrows) throw h.coreThrows
      return Buffer.from('refs')
    },
    uploadPack: async () => {
      if (h.coreThrows) throw h.coreThrows
      return Buffer.from('pack')
    },
    receivePack: async () => {
      h.calls.receive++
      if (h.coreThrows) throw h.coreThrows
      return { data: Buffer.from('unpack ok'), newVersion: h.newVersion, magic: [] }
    },
  },
}))

const { GitTransportError } = await import('@/core')
const { db, users, templates } = await import('@/shared/db')
const route = await import('@/app/[handle]/[slug]/[...git]/route')

const OWNER = 'pr-owner'
const SLUG = 'bread'
let ownerId = ''

const creds = { authorization: `Basic ${Buffer.from('git:token').toString('base64')}` }

const advertise = (svc: 'git-upload-pack' | 'git-receive-pack') =>
  route.GET(new Request(`http://localhost/${OWNER}/${SLUG}.git/info/refs?service=${svc}`, { headers: creds }), {
    params: Promise.resolve({ handle: OWNER, slug: `${SLUG}.git`, git: ['info', 'refs'] }),
  })

const service = (path: 'git-upload-pack' | 'git-receive-pack') =>
  route.POST(new Request(`http://localhost/${OWNER}/${SLUG}.git/${path}`, { method: 'POST', headers: creds, body: 'pack' }), {
    params: Promise.resolve({ handle: OWNER, slug: `${SLUG}.git`, git: [path] }),
  })

beforeAll(async () => {
  await db.execute(sql`truncate table ${templates}, ${users} restart identity cascade`)
  const [u] = await db.insert(users).values({ handle: OWNER }).returning({ id: users.id })
  ownerId = u.id
  await db.insert(templates).values({ ownerId, slug: SLUG, title: { en: 'bread' }, currentVersion: 1 })
}, 60_000)

beforeEach(() => {
  h.auth = { userId: ownerId, scope: 'write' }
  h.coreThrows = null
  h.watchersThrow = false
  h.newVersion = null
  h.captured = []
  h.calls.receive = 0
})

describe('сбой ядра — понятный отказ протокола, а не 500 фреймворка', () => {
  const cases: [name: string, code: 'unavailable' | 'timeout' | 'not-found' | 'internal', status: number][] = [
    ['ядро недоступно', 'unavailable', 503],
    ['истёк дедлайн', 'timeout', 504],
    ['ядро не знает репозитория', 'not-found', 404],
    ['неожиданная ошибка', 'internal', 502],
  ]

  it.each(cases)('%s → %s даёт нужный код на всех четырёх операциях', async (_name, code, status) => {
    h.coreThrows = new GitTransportError(code, 'test-op')
    for (const res of [await advertise('git-upload-pack'), await advertise('git-receive-pack'), await service('git-upload-pack'), await service('git-receive-pack')]) {
      expect(res.status).toBe(status)
      // Ответ читает git-клиент: HTML страницы ошибки ему не годится.
      expect(res.headers.get('Content-Type')).toContain('text/plain')
    }
  })

  it('временный отказ просит повторить, а не молчит', async () => {
    h.coreThrows = new GitTransportError('unavailable', 'test-op')
    expect((await advertise('git-upload-pack')).headers.get('Retry-After')).toBeTruthy()
    h.coreThrows = new GitTransportError('timeout', 'test-op')
    expect((await advertise('git-upload-pack')).headers.get('Retry-After')).toBeTruthy()
  })

  it('каждый отказ уходит в наблюдаемость с операцией и репозиторием', async () => {
    h.coreThrows = new GitTransportError('unavailable', 'info/refs upload-pack')
    await advertise('git-upload-pack')
    expect(h.captured).toContainEqual(
      expect.objectContaining({ where: 'git.core', op: 'info/refs upload-pack', code: 'unavailable', owner: OWNER, slug: SLUG }),
    )
  })

  it('ошибка НЕ типа GitTransportError тоже не уходит в 500 фреймворка', async () => {
    h.coreThrows = new Error('что угодно из глубины')
    expect((await service('git-receive-pack')).status).toBe(502)
  })
})

describe('после принятого пака ответ не зависит от эффектов доставки', () => {
  it('сбой чтения наблюдателей не превращает успешный push в ошибку', async () => {
    h.newVersion = 2
    h.watchersThrow = true
    const res = await service('git-receive-pack')
    expect(res.status).toBe(200)
    // Именно исходные байты receive-pack: клиент обязан увидеть свой успех.
    expect(await res.text()).toBe('unpack ok')
    expect(h.calls.receive).toBe(1)
  })

  it('провал доставки виден в наблюдаемости, а не проглочен', async () => {
    h.newVersion = 2
    h.watchersThrow = true
    await service('git-receive-pack')
    expect(h.captured).toContainEqual(expect.objectContaining({ where: 'git.push-notify', slug: SLUG }))
  })

  it('повторной записи из-за сбоя эффекта не происходит', async () => {
    h.newVersion = 2
    h.watchersThrow = true
    await service('git-receive-pack')
    expect(h.calls.receive).toBe(1) // ядро вызвано ровно один раз
  })

  it('без новой версии эффекты не запускаются вовсе', async () => {
    h.newVersion = null
    h.watchersThrow = true
    expect((await service('git-receive-pack')).status).toBe(200)
    expect(h.captured).toEqual([])
  })
})
