import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Контрактная матрица машинной поверхности `/raw`. До неё у route не было НИ ОДНОГО
 * теста: покрыт был только чистый генератор скрипта, поэтому мутации «отдать скрипт
 * как text/html», «сменить расширение файла», «снять проверку доступа» проходили весь
 * набор зелёными.
 *
 * Проверяется то, что делает поверхность машинной: кто получает содержимое, что уходит
 * в общий кеш, чем отвечает предъявленный токен, и как выглядит артефакт (тип, имя
 * файла, происхождение).
 */
const h = vi.hoisted(() => ({ auth: null as null | { userId: string; scope: 'read' | 'write' } }))
vi.mock('@/shared/auth/api-token', () => ({ verifyApiToken: async () => h.auth }))
vi.mock('@/shared/auth/session', () => ({ getSession: async () => null, requireSession: async () => null }))
// getLang читает куку, а вне запроса Next её нет: язык здесь не предмет проверки.
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'en' }))

const { db, users, templates, templateVersions, steps } = await import('@/shared/db')
const route = await import('@/app/[handle]/[slug]/raw/route')

const OWNER = 'raw-owner'
const uid: Record<string, string> = {}

const params = (slug: string) => ({ params: Promise.resolve({ handle: OWNER, slug }) })
const get = (slug: string, init: RequestInit = {}, query = '') =>
  route.GET(new Request(`http://localhost/${OWNER}/${slug}/raw${query}`, init), params(slug))

async function makeList(slug: string, over: Record<string, unknown> = {}) {
  const [t] = await db
    .insert(templates)
    .values({ ownerId: uid.owner, slug, title: { en: slug }, currentVersion: 1, ...over })
    .returning({ id: templates.id })
  const [v] = await db
    .insert(templateVersions)
    .values({ templateId: t.id, version: 1, note: 'v1' })
    .returning({ id: templateVersions.id })
  await db.insert(steps).values({ versionId: v.id, n: 1, title: { en: 'Step' }, command: 'echo hi' })
  return t.id
}

beforeAll(async () => {
  process.env.APP_URL = 'https://canonical.test'
  // Своя изолированная песочница: тест повторно прогоняется на той же базе.
  await db.delete(users).where(eq(users.handle, OWNER))
  const [u] = await db.insert(users).values({ handle: OWNER, name: OWNER }).returning({ id: users.id })
  uid.owner = u.id
  await makeList('pub')
  await makeList('priv', { visibility: 'private' })
  await makeList('hidden', { moderation: 'hidden' })
})

describe('/raw: кто получает содержимое', () => {
  it('публичный список — 200 анониму', async () => {
    const res = await get('pub')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('echo hi')
  })

  it('приватный список анониму — 404, и он неотличим от несуществующего', async () => {
    const priv = await get('priv')
    const missing = await get('no-such-list')
    expect(priv.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await priv.text()).toBe(await missing.text())
  })

  it('скрытый модерацией — 404 анониму и НЕ уходит в общий кеш', async () => {
    const res = await get('hidden')
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('приватный список отдаётся владельцу по токену', async () => {
    h.auth = { userId: uid.owner, scope: 'read' }
    const res = await get('priv', { headers: { authorization: 'Bearer sf_valid' } })
    h.auth = null
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('echo hi')
  })

  it('невалидный токен отклоняется, а не игнорируется молча', async () => {
    h.auth = null
    const res = await get('pub', { headers: { authorization: 'Bearer sf_revoked' } })
    expect(res.status).toBe(401)
  })
})

describe('/raw: политика кеша', () => {
  it('публичный без токена — общий кеш и честный Vary', async () => {
    const res = await get('pub')
    expect(res.headers.get('cache-control')).toContain('public')
    // Окна свежести быть не должно: инвалидацию внешнему кешу слать некому, и после
    // закрытия списка аноним получал бы скрипт из кеша мимо проверки доступа.
    expect(res.headers.get('cache-control')).toContain('no-cache')
    expect(res.headers.get('cache-control') ?? '').not.toMatch(/max-age=[1-9]/)
    const vary = res.headers.get('vary') ?? ''
    expect(vary).toContain('Cookie')
    expect(vary).toContain('Authorization')
    expect(vary).toContain('Accept-Language')
  })

  it('ответ по токену не кладётся в общий кеш', async () => {
    h.auth = { userId: uid.owner, scope: 'read' }
    const res = await get('priv', { headers: { authorization: 'Bearer sf_valid' } })
    h.auth = null
    expect(res.headers.get('cache-control')).toContain('no-store')
  })

  it('повторный запрос с If-None-Match даёт 304 без тела', async () => {
    const first = await get('pub')
    const etag = first.headers.get('etag') ?? ''
    expect(etag).not.toBe('')
    const second = await get('pub', { headers: { 'if-none-match': etag } })
    expect(second.status).toBe(304)
    expect(await second.text()).toBe('')
  })
})

describe('/raw: форма артефакта', () => {
  it('тип ответа и расширение файла соответствуют диалекту', async () => {
    const sh = await get('pub')
    expect(sh.headers.get('content-type')).toContain('shellscript')
    expect(sh.headers.get('content-disposition')).toContain('.sh"')

    const py = await get('pub', {}, '?lang=py')
    expect(py.headers.get('content-type')).toContain('python')
    expect(py.headers.get('content-disposition')).toContain('.py"')
  })

  it('происхождение берётся из конфигурации, а не из адреса запроса', async () => {
    const body = await (await get('pub')).text()
    expect(body).toContain('https://canonical.test/')
    expect(body).not.toContain('localhost')
  })

  it('слаг из одних дефисов не даёт имя файла, начинающееся с дефиса', async () => {
    await makeList('-')
    const res = await get('-')
    const cd = res.headers.get('content-disposition') ?? ''
    expect(cd).toContain('filename="')
    expect(cd).not.toContain('filename="-')
  })
})
