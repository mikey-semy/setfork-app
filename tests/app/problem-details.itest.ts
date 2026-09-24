import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../helpers/reset-db'

/**
 * RFC 9457 PROBLEM DETAILS на публичных машинных адресах (ревью соответствия 23.09).
 *
 * Раньше каждый адрес отказывал по-своему: `{"error":"not_found"}`, голый «Not found»,
 * `{"error":"rate_limited"}`. Теперь — `application/problem+json` с прежним кодом в поле
 * `error`, чтобы не сломать тех, кто его уже читает. Подменены сессия, язык и счётчик
 * лимита; база и маршруты — настоящие.
 */
const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string }, limited: false }))
vi.mock('@/shared/auth/session', () => ({ getSession: async () => h.session }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'en' }))
vi.mock('@/shared/rate-limit', async (orig) => ({
  ...(await orig()),
  rateLimit: async () => (h.limited ? { ok: false, retryAfter: 42 } : { ok: true, remaining: 1, retryAfter: 0 }),
}))

const { db, steps, templateVersions, templates, users } = await import('@/shared/db')
const { GET: dataGet } = await import('@/app/[handle]/[slug]/data.json/route')
const { GET: exportGet } = await import('@/app/[handle]/[slug]/export/route')
const { GET: skillMdGet } = await import('@/app/[handle]/[slug]/SKILL.md/route')
const { GET: skillTarGet } = await import('@/app/[handle]/[slug]/skill.tar.gz/route')

const OWNER = 'pd-owner'
let tplId = ''
const params = (slug: string) => ({ params: Promise.resolve({ handle: OWNER, slug }) })
const req = (path: string, headers: Record<string, string> = {}) => new Request(`https://setfork.test/${OWNER}/${path}`, { headers })

const SURFACES = {
  'data.json': (slug: string) => dataGet(req(`${slug}/data.json`), params(slug)),
  export: (slug: string) => exportGet(req(`${slug}/export`), params(slug)),
  'SKILL.md': (slug: string) => skillMdGet(req(`${slug}/SKILL.md`), params(slug)),
  'skill.tar.gz': (slug: string) => skillTarGet(req(`${slug}/skill.tar.gz`), params(slug)),
}

beforeAll(async () => {
  await resetTables([steps, templateVersions, templates, users])
  const [o] = await db.insert(users).values({ handle: OWNER }).returning({ id: users.id })
  const [t] = await db
    .insert(templates)
    .values({ ownerId: o.id, slug: 'secret', title: { en: 'Secret' }, status: 'published', visibility: 'private', currentVersion: 1 })
    .returning({ id: templates.id })
  tplId = t.id
  const [v] = await db.insert(templateVersions).values({ templateId: tplId, version: 1, note: 'v1' }).returning({ id: templateVersions.id })
  await db.insert(steps).values({ versionId: v.id, n: 1, title: { en: 'Step' } })
})

beforeEach(() => {
  h.session = null
  h.limited = false
})

async function expectProblem(res: Response, status: number, error: string) {
  expect(res.status).toBe(status)
  expect(res.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8')
  expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  const body = await res.json()
  expect(body).toMatchObject({ type: 'about:blank', status, error })
  expect(typeof body.title).toBe('string')
  expect(body.title.length).toBeGreaterThan(0)
  return body
}

describe('нет списка — Problem Details на каждом публичном машинном адресе', () => {
  it.each(Object.entries(SURFACES))('%s: 404, error=not_found', async (_name, get) => {
    const body = await expectProblem(await get('no-such-list'), 404, 'not_found')
    expect(body.title).toBe('Not Found')
    expect(body.detail).toBeTruthy()
  })

  it.each(Object.entries(SURFACES))('%s: чужой приватный неотличим от несуществующего — побайтно', async (_name, get) => {
    const missing = await (await get('no-such-list')).text()
    const hidden = await (await get('secret')).text()
    expect(hidden).toBe(missing)
  })
})

describe('data.json: токен и лимит', () => {
  it('отклонённый токен — 401 с WWW-Authenticate (RFC 6750)', async () => {
    const res = await dataGet(req('secret/data.json', { authorization: 'Bearer sf_not_a_real_token' }), params('secret'))
    await expectProblem(res, 401, 'invalid_token')
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer error="invalid_token"')
  })

  it('лимит — 429 с Retry-After и прежним полем retryAfter', async () => {
    h.limited = true
    const res = await dataGet(req('secret/data.json'), params('secret'))
    const body = await expectProblem(res, 429, 'rate_limited')
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(body.retryAfter).toBe(42)
  })

  it('успешный ответ — по-прежнему application/json', async () => {
    await db.update(templates).set({ visibility: 'public' }).where(eq(templates.id, tplId))
    try {
      const res = await dataGet(req('secret/data.json'), params('secret'))
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    } finally {
      await db.update(templates).set({ visibility: 'private' }).where(eq(templates.id, tplId))
    }
  })
})
