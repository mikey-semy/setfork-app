import { sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Git-транспорт — третья поверхность того же объекта рядом с `/raw` и `data.json`, и
// анти-перечислительную политику он обязан соблюдать так же: «списка нет» и «список
// есть, но не ваш» отвечают ОДИНАКОВО. Иначе слаг, который выводится из заголовка
// публичным правилом нормализации, превращает транспорт в перечислитель чужих
// приватных списков — 240 запросов в минуту на адрес.
//
// Мокается ровно граница внешнего мира: проверка токена и вызовы ядра.
const h = vi.hoisted(() => ({
  auth: null as null | { userId: string; scope: 'read' | 'write' },
  authThrows: false,
  calls: { upload: 0, receive: 0 },
}))

vi.mock('@/shared/auth/api-token', () => ({
  verifyApiToken: async () => {
    if (h.authThrows) throw new Error('token store is down')
    return h.auth
  },
}))
vi.mock('@/features/git/core', () => ({
  gitCore: {
    infoRefsUploadPack: async () => {
      h.calls.upload++
      return Buffer.from('refs')
    },
    infoRefsReceivePack: async () => {
      h.calls.receive++
      return Buffer.from('refs')
    },
  },
}))

const { db, users, templates, collaborators } = await import('@/shared/db')
const route = await import('@/app/[handle]/[slug]/[...git]/route')

const OWNER = 'ga-owner'
const uid: Record<string, string> = {}

/** Реклама рефов — первая же команда любого clone/pull/push. */
const advertise = (slug: string, service: 'git-upload-pack' | 'git-receive-pack', creds?: string) =>
  route.GET(
    new Request(`http://localhost/${OWNER}/${slug}.git/info/refs?service=${service}`, {
      headers: creds ? { authorization: `Basic ${Buffer.from(creds).toString('base64')}` } : {},
    }),
    { params: Promise.resolve({ handle: OWNER, slug: `${slug}.git`, git: ['info', 'refs'] }) },
  )

/** Сам сервис (второй запрос git-клиента) — у него своя ветка кода, и политика там та же. */
const service = (slug: string, path: 'git-upload-pack' | 'git-receive-pack', creds?: string) =>
  route.POST(
    new Request(`http://localhost/${OWNER}/${slug}.git/${path}`, {
      method: 'POST',
      headers: creds ? { authorization: `Basic ${Buffer.from(creds).toString('base64')}` } : {},
      body: 'pack',
    }),
    { params: Promise.resolve({ handle: OWNER, slug: `${slug}.git`, git: [path] }) },
  )

/** Наблюдаемый ответ целиком: и код, и тело, и вызов аутентификации. */
const seen = async (res: Response) => ({
  status: res.status,
  body: await res.text(),
  challenge: res.headers.get('WWW-Authenticate'),
})

const makeList = async (slug: string, over: Record<string, unknown> = {}) => {
  const [t] = await db
    .insert(templates)
    .values({ ownerId: uid.owner, slug, title: { en: slug }, currentVersion: 1, ...over })
    .returning({ id: templates.id })
  return t.id
}

beforeAll(async () => {
  await db.execute(sql`truncate table ${collaborators}, ${templates}, ${users} restart identity cascade`)
  for (const k of ['owner', 'collab', 'stranger']) {
    const [u] = await db
      .insert(users)
      .values({ handle: k === 'owner' ? OWNER : `ga-${k}` })
      .returning({ id: users.id })
    uid[k] = u.id
  }
  await makeList('public-list')
  const priv = await makeList('private-list', { visibility: 'private' })
  await db.insert(collaborators).values({ templateId: priv, userId: uid.collab })
  await makeList('draft-list', { status: 'draft' })
  await makeList('hidden-list', { moderation: 'hidden' })
}, 60_000)

beforeEach(() => {
  h.auth = null
  h.authThrows = false
  h.calls.upload = 0
  h.calls.receive = 0
})

const CLOSED = ['private-list', 'draft-list', 'hidden-list'] as const

describe('аноним не может отличить закрытый список от несуществующего', () => {
  it.each(CLOSED)('%s отвечает анониму ровно так же, как несуществующий', async (slug) => {
    const closed = await seen(await advertise(slug, 'git-upload-pack'))
    const missing = await seen(await advertise('no-such-list-9x8', 'git-upload-pack'))
    expect(closed).toEqual(missing)
    // Форма ответа — вызов аутентификации, как у GitHub: он не говорит, есть ли объект.
    expect(closed.status).toBe(401)
    expect(closed.challenge).toContain('Basic')
  })

  it('то же самое на сервисе записи — там оракул и был найден на проде', async () => {
    const closed = await seen(await advertise('private-list', 'git-receive-pack'))
    const missing = await seen(await advertise('no-such-list-9x8', 'git-receive-pack'))
    expect(closed).toEqual(missing)
    expect(closed.status).toBe(401)
  })

  it('публичный список по-прежнему клонируется анонимно', async () => {
    const res = await advertise('public-list', 'git-upload-pack')
    expect(res.status).toBe(200)
    expect(h.calls.upload).toBe(1)
  })

  it('на публичный список push анониму не рекламируется', async () => {
    expect((await advertise('public-list', 'git-receive-pack')).status).toBe(401)
    expect(h.calls.receive).toBe(0)
  })
})

describe('предъявленный кредитив не раскрывает чужого', () => {
  it.each(CLOSED)('посторонний с валидным токеном получает у %s то же, что у несуществующего', async (slug) => {
    h.auth = { userId: uid.stranger, scope: 'write' }
    const closed = await seen(await advertise(slug, 'git-upload-pack', 'git:t'))
    const missing = await seen(await advertise('no-such-list-9x8', 'git-upload-pack', 'git:t'))
    expect(closed).toEqual(missing)
    expect(closed.status).toBe(404)
  })

  it('неверный токен — отказ аутентификации, независимо от того, что за списком', async () => {
    h.auth = null // verifyApiToken не признал секрет
    const onPublic = await seen(await advertise('public-list', 'git-upload-pack', 'git:bad'))
    const onPrivate = await seen(await advertise('private-list', 'git-upload-pack', 'git:bad'))
    const onMissing = await seen(await advertise('no-such-list-9x8', 'git-upload-pack', 'git:bad'))
    expect(onPublic.status).toBe(401)
    expect(onPrivate).toEqual(onMissing)
  })
})

describe('кому список виден, тот его и клонирует', () => {
  it('владелец читает свой приватный список', async () => {
    h.auth = { userId: uid.owner, scope: 'read' }
    expect((await advertise('private-list', 'git-upload-pack', 'git:t')).status).toBe(200)
  })

  it('соредактор — тоже: в вебе он этот список ведёт, а git отвечал ему 404', async () => {
    h.auth = { userId: uid.collab, scope: 'read' }
    expect((await advertise('private-list', 'git-upload-pack', 'git:t')).status).toBe(200)
  })

  it('соредактор видит и черновик', async () => {
    h.auth = { userId: uid.collab, scope: 'read' }
    // Черновик соредактору виден по общему предикату; у него нет доступа к hidden —
    // модерационный takedown обходит только владелец.
    expect((await advertise('draft-list', 'git-upload-pack', 'git:t')).status).toBe(404)
    h.auth = { userId: uid.owner, scope: 'read' }
    expect((await advertise('hidden-list', 'git-upload-pack', 'git:t')).status).toBe(200)
  })
})

describe('отказ по правам отличается от отказа по личности', () => {
  it('read-only токен на push — 403, а не повторный запрос пароля', async () => {
    h.auth = { userId: uid.owner, scope: 'read' }
    const res = await advertise('public-list', 'git-receive-pack', 'git:t')
    expect(res.status).toBe(403)
    // 401 отправил бы git к credential helper за новым паролем, хотя личность
    // доказана и дело не в ней.
    expect(res.headers.get('WWW-Authenticate')).toBeNull()
    expect(h.calls.receive).toBe(0)
  })

  it('посторонний с write-токеном на ПУБЛИЧНЫЙ список — 403: существование не секрет', async () => {
    h.auth = { userId: uid.stranger, scope: 'write' }
    expect((await advertise('public-list', 'git-receive-pack', 'git:t')).status).toBe(403)
  })
})

describe('сам сервис защищён так же, как реклама рефов', () => {
  // Клиент делает ДВА запроса: сначала info/refs, потом сам сервис. Проверка только
  // на первом оставляла бы второй открытым для того, кто ходит curl'ом, а не git'ом.
  it.each(CLOSED)('POST git-upload-pack к %s анониму неотличим от несуществующего', async (slug) => {
    const closed = await seen(await service(slug, 'git-upload-pack'))
    const missing = await seen(await service('no-such-list-9x8', 'git-upload-pack'))
    expect(closed).toEqual(missing)
    expect(closed.status).toBe(401)
    expect(h.calls.upload).toBe(0)
  })

  it('POST git-receive-pack: посторонний с токеном не узнаёт про приватный список', async () => {
    h.auth = { userId: uid.stranger, scope: 'write' }
    const closed = await seen(await service('private-list', 'git-receive-pack', 'git:t'))
    const missing = await seen(await service('no-such-list-9x8', 'git-receive-pack', 'git:t'))
    expect(closed).toEqual(missing)
    expect(closed.status).toBe(404)
    expect(h.calls.receive).toBe(0)
  })

  it('read-only токен и на самом сервисе получает 403', async () => {
    h.auth = { userId: uid.owner, scope: 'read' }
    expect((await service('public-list', 'git-receive-pack', 'git:t')).status).toBe(403)
  })
})

describe('авария хранилища токенов — не отказ доступа', () => {
  it('падение verifyApiToken даёт 503, а не «неверный токен»', async () => {
    h.authThrows = true
    const res = await advertise('public-list', 'git-upload-pack', 'git:t')
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    // Именно 401 здесь заставлял человека перевыпускать исправный секрет, а CI —
    // записывать аварию как ошибку доступа.
    expect(res.status).not.toBe(401)
  })
})
