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
  // Падает ли ПОСТАНОВКА задачи доставки — единственный эффект, оставшийся на пути пуша.
  enqueueThrows: false,
  newVersion: null as number | null,
  magic: [] as { branch: string; tipSha: string }[],
  captured: [] as { where: unknown; op?: unknown }[],
  calls: { receive: 0 },
}))

vi.mock('@/shared/auth/api-token', () => ({ verifyApiToken: async () => h.auth }))
vi.mock('@/shared/observability', () => ({
  captureError: (_e: unknown, ctx: Record<string, unknown>) => {
    h.captured.push(ctx as { where: unknown; op?: unknown })
  },
}))
// Очередь настоящая по форме (строка в jobs), но управляемая: тесту нужно уметь
// уронить именно ПОСТАНОВКУ — это единственный эффект, оставшийся на пути пуша.
vi.mock('@/shared/jobs/queue', () => ({
  enqueueJob: async (type: string, payload: Record<string, unknown>) => {
    if (h.enqueueThrows) throw new Error('queue is down')
    const { db: database, jobs: jobsTable } = await import('@/shared/db')
    await database.insert(jobsTable).values({ type, payload })
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
      return { data: Buffer.from('unpack ok'), newVersion: h.newVersion, magic: h.magic }
    },
  },
}))

const { GitTransportError } = await import('@/core')
const { db, jobs, users, templates } = await import('@/shared/db')
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

beforeEach(async () => {
  h.auth = { userId: ownerId, scope: 'write' }
  h.coreThrows = null
  h.enqueueThrows = false
  h.newVersion = null
  h.magic = []
  h.captured = []
  h.calls.receive = 0
  await db.delete(jobs)
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
  // С выносом доставки в очередь (карточка 008) маршрут больше не читает наблюдателей и
  // никого не рассылает: он ставит ОДНУ задачу и отдаёт байты. Сама доставка проверяется
  // там, где теперь живёт, — tests/features/git/push-effects.itest.ts.
  it('клиент получает исходные байты receive-pack', async () => {
    h.newVersion = 2
    const res = await service('git-receive-pack')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('unpack ok')
    expect(h.calls.receive).toBe(1)
  })

  it('на пути пуша ставится ровно одна задача доставки', async () => {
    h.newVersion = 2
    await service('git-receive-pack')
    const rows = await db.select({ type: jobs.type }).from(jobs)
    expect(rows.map((r) => r.type)).toEqual(['git_push'])
  })

  it('сбой ПОСТАНОВКИ не превращает успешный push в ошибку, но виден в наблюдаемости', async () => {
    h.newVersion = 2
    h.enqueueThrows = true
    const res = await service('git-receive-pack')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('unpack ok')
    expect(h.captured).toContainEqual(expect.objectContaining({ where: 'git.push-effects.enqueue', slug: SLUG }))
    expect(h.calls.receive).toBe(1) // повторной записи из-за сбоя эффекта не происходит
  })

  it('пуш, которому нечего доставлять, задачу НЕ ставит', async () => {
    // Ни новой версии, ни ветки правки (например, обновление существующего рефа):
    // пустое намерение в очереди — это шум, который воркер будет разбирать зря.
    h.newVersion = null
    await service('git-receive-pack')
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(jobs)
    expect(n).toBe(0)
  })

  it('ветка правки без новой версии — эффект есть, задача ставится', async () => {
    h.newVersion = null
    h.magic = [{ branch: 'u/pr-owner/main', tipSha: 'abc123' }]
    await service('git-receive-pack')
    const rows = await db.select({ type: jobs.type }).from(jobs)
    expect(rows.map((r) => r.type)).toEqual(['git_push'])
  })
})
