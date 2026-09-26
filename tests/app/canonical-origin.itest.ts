import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../helpers/reset-db'

/**
 * АДРЕС НАРУЖУ — КАНОНИЧЕСКИЙ, ДАЖЕ КОГДА ЗАПРОС ПРИШЁЛ НА АДРЕС КОНТЕЙНЕРА (fe#968, K15).
 *
 * За прокси `req.url` равен `https://0.0.0.0:3000/…`, и прод отдавал этот адрес в `url`
 * конверта `data.json` и в ссылке «Open on SetFork» встраивания. Здесь запрос приходит
 * ровно туда, а канон задан окружением, как на проде. Подменены только окружение, язык
 * зрителя, сессия и лимит; база и маршруты — настоящие.
 *
 * Заодно — язык насквозь: русский список без перевода, запрошенный по-английски.
 */
const h = vi.hoisted(() => ({ prevAppUrl: process.env.APP_URL }))
vi.mock('@/shared/auth/session', () => ({ getSession: async () => null }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'en' }))
vi.mock('@/shared/rate-limit', async (orig) => ({
  ...(await orig()),
  rateLimit: async () => ({ ok: true, remaining: 1, retryAfter: 0 }),
}))

const { db, steps, templateVersions, templates, users } = await import('@/shared/db')
const { GET: dataGet } = await import('@/app/[handle]/[slug]/data.json/route')
const { GET: embedGet } = await import('@/app/[handle]/[slug]/embed/route')
const { GET: atomGet } = await import('@/app/[handle]/[slug]/releases.atom/route')

const CANON = 'https://canon.test'
const OWNER = 'k15owner'
const SLUG = 'sufle'
const BIND = `https://0.0.0.0:3000/${OWNER}/${SLUG}`
const params = { params: Promise.resolve({ handle: OWNER, slug: SLUG }) }

beforeAll(async () => {
  process.env.APP_URL = CANON
  await resetTables([steps, templateVersions, templates, users])
  const [o] = await db.insert(users).values({ handle: OWNER }).returning({ id: users.id })
  const [t] = await db
    .insert(templates)
    .values({ ownerId: o.id, slug: SLUG, title: { ru: 'Суфле' }, status: 'published', visibility: 'public', currentVersion: 1 })
    .returning({ id: templates.id })
  const [v] = await db.insert(templateVersions).values({ templateId: t.id, version: 1, note: 'v1' }).returning({ id: templateVersions.id })
  await db.insert(steps).values({ versionId: v.id, n: 1, title: { ru: 'Замочить желатин' } })
})

afterAll(() => {
  if (h.prevAppUrl === undefined) delete process.env.APP_URL
  else process.env.APP_URL = h.prevAppUrl
})

describe('канонический адрес при запросе на адрес контейнера', () => {
  it('data.json: url — канон; lang — язык текста, requestedLang — запрошенный', async () => {
    const res = await dataGet(new Request(`${BIND}/data.json`), params)
    expect(res.status).toBe(200)
    const env = await res.json()
    expect(env.url).toBe(`${CANON}/${OWNER}/${SLUG}`)
    expect(env.title).toBe('Суфле')
    expect(env.lang).toBe('ru')
    expect(env.requestedLang).toBe('en')
  })

  it('embed: ссылка назад — на канон, текст помечен своим языком', async () => {
    const res = await embedGet(new Request(`${BIND}/embed`), params)
    // Форма ответа сменилась при том же списке — старый ETag не должен дать 304.
    expect(res.headers.get('ETag')).toMatch(/^W\/"r2-/)
    const html = await res.text()
    expect(html).toContain(`href="${CANON}/${OWNER}/${SLUG}"`)
    expect(html).toContain('<div class="title" lang="ru">')
    expect(html).not.toContain('0.0.0.0')
  })

  it('releases.atom: адреса ленты — на канон', async () => {
    const xml = await (await atomGet(new Request(`${BIND}/releases.atom`), params)).text()
    expect(xml).toContain(`${CANON}/${OWNER}/${SLUG}`)
    expect(xml).not.toContain('0.0.0.0')
  })
})
