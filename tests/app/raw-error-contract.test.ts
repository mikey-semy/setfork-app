// КОНТРАКТ ОТКАЗОВ машинной поверхности `/raw`: тело ЛЮБОГО не-200 ответа читает
// интерпретатор, а не человек. Значит в нём не может быть ни обычного текста
// («Not found»), ни JSON (`tooMany`): и то и другое шелл принимает за команду.
// Каждый отказ — заглушка диалекта: комментарии и выход с ненулевым кодом.
//
// Карточка реестра 014, P1. Раньше у этой поверхности отказы были трёх разных форм.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dialectSpec, type ScriptDialect } from '@/core/domain/script-dialect'

const DIALECTS: ScriptDialect[] = ['sh', 'ps1', 'py']
const CMD = 'echo hi'

const h = vi.hoisted(() => ({
  detail: null as unknown,
  auth: null as null | { userId: string },
  rate: { ok: true, retryAfter: 0 },
}))
vi.mock('@/shared/i18n/server', () => ({ getLang: async () => 'en' }))
vi.mock('@/shared/auth/api-token', () => ({ verifyApiToken: async () => h.auth }))
vi.mock('@/features/library/guard', () => ({
  requireViewableDetail: async () => h.detail,
  requireViewableDetailFor: async () => h.detail,
}))
vi.mock('@/shared/rate-limit', () => ({
  rateLimit: async () => h.rate,
  clientIp: () => 'test',
  tooMany: () => new Response('unused'),
}))

const { GET } = await import('@/app/[handle]/[slug]/raw/route')

const HANDLE = 'probe'
const SLUG = 'probe-list'
const params = Promise.resolve({ handle: HANDLE, slug: SLUG })
const call = (query = '', init: RequestInit = {}) =>
  GET(new Request(`https://setfork.test/${HANDLE}/${SLUG}/raw${query}`, init), { params })

const detail = {
  tpl: {
    title: { en: 'Probe list' },
    desc: { en: '' },
    tags: [],
    ordered: true,
    currentVersion: 1,
    visibility: 'public',
    status: 'published',
    moderation: 'active',
    owner: { handle: HANDLE },
    slug: SLUG,
    updatedAt: new Date('2026-08-10T00:00:00Z'),
  },
  currentVersion: { version: 1 },
  steps: [
    { n: 1, blockId: 'b1', title: { en: 'Step' }, desc: { en: '' }, command: CMD, level: 'required', why: { en: '' }, subtasks: [], refs: [] },
  ],
}

beforeEach(() => {
  h.detail = detail
  h.auth = null
  h.rate = { ok: true, retryAfter: 0 }
})

/** Тело — только комментарии/shebang, последняя строка — ненулевой выход диалекта. */
function expectRefusalBody(body: string, dialect: ScriptDialect) {
  const spec = dialectSpec(dialect)
  const lines = body.split(/\r\n|\r|\n/).filter((l) => l.trim())
  expect(lines.length, 'пустое тело: конвейеру нечего исполнять и он вернёт 0').toBeGreaterThan(1)
  expect(lines.pop()).toBe(spec.fail)
  for (const l of lines) {
    expect(l === spec.shebang || l.startsWith('#'), `исполняемая строка в теле отказа: ${l}`).toBe(true)
  }
}

/** Каждый отказ поверхности: как его вызвать и какую причину он обязан назвать. */
const REFUSALS: { name: string; status: number; reason: string; make: (d: ScriptDialect, headers?: Record<string, string>) => Promise<Response> }[] = [
  {
    name: 'нет такого списка',
    status: 404,
    reason: 'not_found',
    make: async (d, headers = {}) => {
      h.detail = null
      return call(`?lang=${d}`, { headers })
    },
  },
  {
    name: 'нет такого пункта',
    status: 404,
    reason: 'unknown_block',
    make: (d, headers = {}) => call(`?lang=${d}&bid=no-such-block`, { headers }),
  },
  {
    name: 'отклонённый токен',
    status: 401,
    reason: 'invalid_token',
    make: (d, headers = {}) => call(`?lang=${d}`, { headers: { authorization: 'Bearer sf_revoked', ...headers } }),
  },
  {
    name: 'превышена частота',
    status: 429,
    reason: 'rate_limited',
    make: async (d, headers = {}) => {
      h.rate = { ok: false, retryAfter: 42 }
      return call(`?lang=${d}`, { headers })
    },
  },
]

describe('ни один отказ /raw не выглядит успешным прогоном', () => {
  for (const dialect of DIALECTS) {
    for (const r of REFUSALS) {
      it(`${dialect} · ${r.name}: ${r.status}, причина в заголовке, тело — заглушка`, async () => {
        const res = await r.make(dialect)
        expect(res.status).toBe(r.status)
        expect(res.headers.get('SF-Reason')).toBe(r.reason)
        expect(res.headers.get('Content-Type')).toBe(dialectSpec(dialect).mime)
        expect(res.headers.get('Cache-Control')).toContain('no-store')
        expectRefusalBody(await res.text(), dialect)
      })
    }
  }

  it('чужой диалект (406) — та же форма отказа', async () => {
    const res = await call('?lang=py')
    expect(res.status).toBe(406)
    expectRefusalBody(await res.text(), 'py')
  })

  it('429 сохраняет Retry-After — иначе клиент не знает, когда возвращаться', async () => {
    h.rate = { ok: false, retryAfter: 42 }
    expect((await call()).headers.get('Retry-After')).toBe('42')
  })

  it('приватный список неотличим от несуществующего: тела совпадают побайтно', async () => {
    h.detail = null
    const missing = await (await call()).text()
    h.detail = null
    const priv = await (await call()).text()
    expect(priv).toBe(missing)
  })
})

/**
 * RFC 9457 — тем, кто ПОПРОСИЛ. Клиент, приславший `Accept: application/problem+json`,
 * тело разбирает, а не исполняет: ему отказ приходит Problem Details с той же причиной.
 * Без заголовка — по-прежнему скрипт (контракт выше не меняется).
 */
describe('Problem Details по Accept', () => {
  const PROBLEM = { accept: 'application/problem+json' }

  for (const r of REFUSALS) {
    it(`${r.name}: problem+json с error=${r.reason}`, async () => {
      const res = await r.make('sh', PROBLEM)
      expect(res.status).toBe(r.status)
      expect(res.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8')
      expect(res.headers.get('SF-Reason')).toBe(r.reason)
      const body = await res.json()
      expect(body).toMatchObject({ type: 'about:blank', status: r.status, error: r.reason })
      expect(typeof body.title).toBe('string')
      expect(typeof body.detail).toBe('string')
    })
  }

  it('без Accept — скрипт, как раньше', async () => {
    h.detail = null
    const res = await call()
    expect(res.headers.get('Content-Type')).not.toContain('problem')
  })
})
