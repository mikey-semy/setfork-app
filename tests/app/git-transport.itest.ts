import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../helpers/reset-db'

// Контракт git smart-HTTP: маршрут вызывается целиком, как его вызовет git-клиент.
// Своих тестов у этой поверхности не было вовсе (карточка 003 кластера K03), а именно
// она решает, кто и что может склонировать и запушить. Тест написан ПЕРЕД разбором файла
// на границы (TARGET.md, шаг 1): он держит поведение протокола, пока модули переезжают.
//
// Настоящие: база, видимость списка, разбор токена, все ветки отказов.
// Мок только на ядро (без него нет git-объектов) и на лимитер (Redis в юнит-окружении нет).
const h = vi.hoisted(() => ({
  coreFails: null as null | Error,
  calls: [] as string[],
}))

vi.mock('@/features/git/core', async () => {
  const { GitTransportError } = await import('@/core')
  const answer = (name: string, body: string) => {
    h.calls.push(name)
    if (h.coreFails) throw h.coreFails
    return new TextEncoder().encode(body)
  }
  return {
    gitCore: {
      infoRefsUploadPack: async () => answer('infoRefsUploadPack', '001e# service=git-upload-pack\n'),
      infoRefsReceivePack: async () => answer('infoRefsReceivePack', '001f# service=git-receive-pack\n'),
      uploadPack: async () => answer('uploadPack', 'PACK'),
      receivePack: async () => {
        h.calls.push('receivePack')
        if (h.coreFails) throw h.coreFails
        return { data: new TextEncoder().encode('unpack ok\n'), newVersion: null, magic: [] }
      },
      listCommits: async () => [],
      branchSnapshot: async () => null,
      GitTransportError,
    },
  }
})

vi.mock('@/shared/rate-limit', () => ({
  clientIp: () => '127.0.0.1',
  rateLimit: async () => ({ ok: true, retryAfter: 0 }),
  tooMany: () => new Response('rate limited', { status: 429 }),
}))

const { db, apiTokens, templates, users } = await import('@/shared/db')
const { hashToken, newToken } = await import('@/shared/auth/api-token')
const { GET, POST } = await import('@/app/[handle]/[slug]/[...git]/route')
const { GitTransportError } = await import('@/core')

const OWNER = 'git-owner'
const PUB = 'public-list'
const PRIV = 'private-list'

let ownerId = ''
let strangerId = ''
const tokens = { ownerWrite: '', ownerRead: '', strangerWrite: '' }

const params = (slug: string, git: string[]) => ({ params: Promise.resolve({ handle: OWNER, slug, git }) })
const basic = (token: string) => ({ authorization: `Basic ${Buffer.from(`x:${token}`).toString('base64')}` })
const url = (slug: string, path: string, query = '') => `https://setfork.ru/${OWNER}/${slug}.git/${path}${query}`

const get = (slug: string, path: string, query = '', headers: Record<string, string> = {}) =>
  GET(new Request(url(slug, path, query), { headers }), params(slug, path.split('/')))
const post = (slug: string, path: string, body: BodyInit, headers: Record<string, string> = {}) =>
  POST(new Request(url(slug, path), { method: 'POST', body, headers }), params(slug, path.split('/')))

async function issueToken(userId: string, scope: 'read' | 'write'): Promise<string> {
  const { token } = newToken()
  await db.insert(apiTokens).values({ userId, name: `t-${scope}-${Math.random()}`, tokenHash: hashToken(token), prefix: 'sf_test…', scope })
  return token
}

beforeAll(async () => {
  await resetTables([apiTokens, templates, users])
  const [o] = await db.insert(users).values({ handle: OWNER }).returning({ id: users.id })
  const [s] = await db.insert(users).values({ handle: 'git-stranger' }).returning({ id: users.id })
  ownerId = o.id
  strangerId = s.id
  await db.insert(templates).values([
    { ownerId, slug: PUB, title: { en: 'Public' }, status: 'published', visibility: 'public' },
    { ownerId, slug: PRIV, title: { en: 'Private' }, status: 'published', visibility: 'private' },
  ])
  tokens.ownerWrite = await issueToken(ownerId, 'write')
  tokens.ownerRead = await issueToken(ownerId, 'read')
  tokens.strangerWrite = await issueToken(strangerId, 'write')
})

afterAll(async () => {
  await resetTables([apiTokens, templates, users])
})

beforeEach(() => {
  h.coreFails = null
  h.calls = []
})

describe('discovery: кто может узнать о существовании репозитория', () => {
  it('публичный список клонируется анонимно', async () => {
    const res = await get(PUB, 'info/refs', '?service=git-upload-pack')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/x-git-upload-pack-advertisement')
    expect(res.headers.get('Cache-Control')).toContain('no-cache')
  })

  it('приватный и НЕСУЩЕСТВУЮЩИЙ отвечают анониму одинаково — 401, без оракула существования', async () => {
    const priv = await get(PRIV, 'info/refs', '?service=git-upload-pack')
    const missing = await get('no-such-list', 'info/refs', '?service=git-upload-pack')
    expect(priv.status).toBe(401)
    expect(missing.status).toBe(401)
    expect(priv.headers.get('WWW-Authenticate')).toContain('Basic')
    expect(await priv.text()).toBe(await missing.text())
  })

  it('владелец с токеном читает свой приватный список', async () => {
    const res = await get(PRIV, 'info/refs', '?service=git-upload-pack', basic(tokens.ownerRead))
    expect(res.status).toBe(200)
  })

  it('посторонний с валидным токеном получает 404 на чужой приватный', async () => {
    const res = await get(PRIV, 'info/refs', '?service=git-upload-pack', basic(tokens.strangerWrite))
    expect(res.status).toBe(404)
  })

  it('read-токен не открывает receive-pack: 403, а не повторный запрос пароля', async () => {
    const res = await get(PUB, 'info/refs', '?service=git-receive-pack', basic(tokens.ownerRead))
    expect(res.status).toBe(403)
    expect(await res.text()).toContain('write scope')
  })

  it('write-токен владельца открывает receive-pack', async () => {
    const res = await get(PUB, 'info/refs', '?service=git-receive-pack', basic(tokens.ownerWrite))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/x-git-receive-pack-advertisement')
  })

  it('неизвестный сервис и чужой путь не обслуживаются', async () => {
    expect((await get(PUB, 'info/refs', '?service=git-evil-pack')).status).toBe(403)
    expect((await get(PUB, 'objects/info/packs')).status).toBe(404)
  })

  it('discovery БЕЗ параметров — это тупой протокол, а не плохой запрос', async () => {
    // «Dumb HTTP clients MUST make a GET request to $GIT_URL/info/refs, without any
    // search/query parameters» (gitprotocol-http). Мы его не обслуживаем — 403,
    // а не 400: запрос валиден, просто сервис не предоставляется.
    const res = await get(PUB, 'info/refs')
    expect(res.status).toBe(403)
  })
})

describe('сервисы: передача байтов и отказы ядра', () => {
  it('upload-pack публичного списка работает анонимно', async () => {
    const res = await post(PUB, 'git-upload-pack', 'want abc')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/x-git-upload-pack-result')
    expect(h.calls).toContain('uploadPack')
  })

  it('receive-pack без кредитива не доходит до ядра', async () => {
    const res = await post(PUB, 'git-receive-pack', 'PACK')
    expect(res.status).toBe(401)
    expect(h.calls).toEqual([])
  })

  it('receive-pack владельца доходит до ядра', async () => {
    const res = await post(PUB, 'git-receive-pack', 'PACK', basic(tokens.ownerWrite))
    expect(res.status).toBe(200)
    expect(h.calls).toContain('receivePack')
  })

  it('недоступное ядро — 503 с Retry-After, а не 500 фреймворка', async () => {
    h.coreFails = new GitTransportError('unavailable', 'upload-pack')
    const res = await post(PUB, 'git-upload-pack', 'want abc')
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })

  it('дедлайн ядра — 504, «нет такого репозитория» — 404, прочее — 502', async () => {
    h.coreFails = new GitTransportError('timeout', 'upload-pack')
    expect((await post(PUB, 'git-upload-pack', 'x')).status).toBe(504)
    h.coreFails = new GitTransportError('not-found', 'upload-pack')
    expect((await post(PUB, 'git-upload-pack', 'x')).status).toBe(404)
    h.coreFails = new GitTransportError('internal', 'upload-pack')
    expect((await post(PUB, 'git-upload-pack', 'x')).status).toBe(502)
  })
})

// Ниже — строгость границы: три карточки ревью (009, 010, 014). До правки эти
// проверки красные, потому что маршрут принимает вход шире протокола.
describe('строгость границы протокола', () => {
  it('discovery принимает РОВНО один параметр service (gitprotocol-http)', async () => {
    const res = await get(PUB, 'info/refs', '?service=git-upload-pack&unexpected=1')
    expect(res.status).toBe(400)
    expect(h.calls).toEqual([]) // отказ до ядра и до базы
  })

  it('Basic без разделителя «:» — это невалидный кредитив, а не пароль целиком', async () => {
    const headers = { authorization: `Basic ${Buffer.from(tokens.ownerWrite).toString('base64')}` }
    const res = await get(PRIV, 'info/refs', '?service=git-upload-pack', headers)
    expect(res.status).toBe(401)
  })

  it('испорченный gzip — ошибка запроса (400), а не авария сервера', async () => {
    const res = await post(PUB, 'git-upload-pack', Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xff]), {
      'content-encoding': 'gzip',
    })
    expect(res.status).toBe(400)
    expect(h.calls).toEqual([])
  })
})
