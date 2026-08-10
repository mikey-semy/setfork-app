import { eq, sql } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTables } from '../helpers/reset-db'

// Кеш машинных поверхностей против РЕАЛЬНОЙ базы: маршрут вызывается целиком, как его
// вызовет прокси. Проверяется главное свойство — у публичного ответа нет окна свежести,
// поэтому закрытие списка виден кешу сразу же, на первом же обращении к origin.
//
// Мокаются только сессия и язык (их источник — заголовки запроса, которых в тесте нет).
// Guard, видимость и данные — настоящие.
const h = vi.hoisted(() => ({ session: null as null | { userId: string; handle: string }, lang: 'ru' as 'ru' | 'en' }))
vi.mock('@/shared/auth/session', () => ({ getSession: async () => h.session }))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => h.lang }))

const { db, steps, templateVersions, templates, users } = await import('@/shared/db')
const { GET: dataGet } = await import('@/app/[handle]/[slug]/data.json/route')
const { GET: embedGet } = await import('@/app/[handle]/[slug]/embed/route')
const { GET: badgeGet } = await import('@/app/[handle]/[slug]/badge/[kind]/route')
const { GET: exportGet } = await import('@/app/[handle]/[slug]/export/route')
const { GET: rawGet } = await import('@/app/[handle]/[slug]/raw/route')

const OWNER = 'cache-owner'
const SLUG = 'bread'
let ownerId = ''
let tplId = ''

const params = (slug = SLUG) => Promise.resolve({ handle: OWNER, slug })
const badgeParams = (kind = 'stars.svg', slug = SLUG) => Promise.resolve({ handle: OWNER, slug, kind })
const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers })

const base = `https://setfork.ru/${OWNER}/${SLUG}`

/** Ответы всех машинных поверхностей на один и тот же список. */
const surfaces = async () => ({
  data: await dataGet(req(`${base}/data.json?lang=ru`), { params: params() }),
  embed: await embedGet(req(`${base}/embed`), { params: params() }),
  badge: await badgeGet(req(`${base}/badge/stars.svg`), { params: badgeParams() }),
  raw: await rawGet(req(`${base}/raw`), { params: params() }),
})

beforeAll(async () => {
  await resetTables(sql`${steps}, ${templateVersions}, ${templates}, ${users}`)
  const [o] = await db.insert(users).values({ handle: OWNER }).returning({ id: users.id })
  ownerId = o.id
  const [t] = await db
    .insert(templates)
    .values({ ownerId, slug: SLUG, title: { ru: 'Хлеб' }, status: 'published', visibility: 'public' })
    .returning({ id: templates.id })
  tplId = t.id
  const [v] = await db.insert(templateVersions).values({ templateId: tplId, version: 1, note: 'v1' }).returning({ id: templateVersions.id })
  await db.insert(steps).values({ versionId: v.id, n: 1, title: { ru: 'Замесить' } })
})

beforeEach(async () => {
  h.session = null
  h.lang = 'ru'
  await db.update(templates).set({ status: 'published', visibility: 'public', moderation: 'active' }).where(eq(templates.id, tplId))
})

describe('публичный ответ можно хранить, но не отдавать без проверки', () => {
  it('ни одна поверхность не объявляет окна свежести', async () => {
    for (const [name, res] of Object.entries(await surfaces())) {
      const cc = res.headers.get('Cache-Control') ?? ''
      expect(res.status, name).toBe(200)
      expect(cc, name).toContain('no-cache')
      expect(cc, name).not.toMatch(/max-age=[1-9]|stale-while-revalidate|s-maxage/)
    }
  })

  it('у каждой поверхности есть ETag — ревалидация стоит 304, а не тела', async () => {
    for (const [name, res] of Object.entries(await surfaces())) {
      expect(res.headers.get('ETag'), name).toBeTruthy()
    }
  })

  it('повторный запрос с тем же ETag получает 304 без тела', async () => {
    const first = await embedGet(req(`${base}/embed`), { params: params() })
    const etag = first.headers.get('ETag')!
    const second = await embedGet(req(`${base}/embed`, { 'If-None-Match': etag }), { params: params() })
    expect(second.status).toBe(304)
    expect(await second.text()).toBe('')
  })

  it('embed различает языки: другой язык — другой ETag и своё тело', async () => {
    const ru = await embedGet(req(`${base}/embed`), { params: params() })
    h.lang = 'en'
    const en = await embedGet(req(`${base}/embed`), { params: params() })
    expect(en.headers.get('ETag')).not.toBe(ru.headers.get('ETag'))
    // Договорный язык обязан быть в ключе кеша, иначе русский iframe достанется
    // англоязычному сайту.
    expect(en.headers.get('Vary')).toContain('Accept-Language')
  })
})

describe('закрытие доступа видно сразу, без окна ожидания', () => {
  it.each([
    ['приватный', { visibility: 'private' as const }],
    ['черновик', { status: 'draft' as const }],
    ['снят модерацией', { moderation: 'hidden' as const }],
    ['под флагом', { moderation: 'flagged' as const }],
  ])('%s список анониму не отдаётся ни одной поверхностью', async (_name, patch) => {
    await db.update(templates).set(patch).where(eq(templates.id, tplId))
    const res = await surfaces()
    for (const [name, r] of Object.entries(res)) {
      expect(r.status, name).toBe(404)
      // Отказ тоже не хранится: иначе возврат списка в публичный доступ не был бы
      // виден чужому прокси.
      expect(r.headers.get('Cache-Control'), name).toBe('private, no-store')
    }
  })
})

describe('приватное не попадает в общий кеш', () => {
  it('владелец видит свой приватный список, но ответ помечен private, no-store', async () => {
    await db.update(templates).set({ visibility: 'private' }).where(eq(templates.id, tplId))
    h.session = { userId: ownerId, handle: OWNER }
    const res = await dataGet(req(`${base}/data.json?lang=ru`), { params: params() })
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('скачивание идёт по сессии и общим кешем не хранится', async () => {
    h.session = { userId: ownerId, handle: OWNER }
    const res = await exportGet(req(`${base}/export?format=md`), { params: params() })
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(res.headers.get('Vary')).toContain('Cookie')
  })

  it('несуществующий список: отказ без кеша на всех поверхностях', async () => {
    const gone = 'no-such-list'
    const res = [
      await dataGet(req(`${base}/data.json`), { params: params(gone) }),
      await embedGet(req(`${base}/embed`), { params: params(gone) }),
      await badgeGet(req(`${base}/badge/stars.svg`), { params: badgeParams('stars.svg', gone) }),
      await exportGet(req(`${base}/export`), { params: params(gone) }),
      await rawGet(req(`${base}/raw`), { params: params(gone) }),
    ]
    for (const r of res) {
      expect(r.status).toBe(404)
      expect(r.headers.get('Cache-Control')).toBe('private, no-store')
    }
  })

  it('неизвестный вид бейджа тоже не кешируется как отказ', async () => {
    const res = await badgeGet(req(`${base}/badge/unknown.svg`), { params: badgeParams('unknown.svg') })
    expect(res.status).toBe(404)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })
})
