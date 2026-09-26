import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CORSRule } from '@aws-sdk/client-s3'

/**
 * CORS бакета загрузок: установка правила и проверка предзапросом.
 * Подменены только внешние: хранилище (`s3.ts` — его CORS и presign) и сеть (fetch).
 * Настройки медиа настоящие (env → getMediaSettings), поэтому итест.
 */
const store = vi.hoisted(() => ({ rules: [] as CORSRule[], put: [] as CORSRule[][] }))
vi.mock('@/shared/media/s3', () => ({
  getUploadsCors: vi.fn(async () => store.rules),
  putUploadsCors: vi.fn(async (rules: CORSRule[]) => void store.put.push(rules)),
  presignPost: vi.fn(async () => ({ url: 'https://setfork-uploads.s3.test/', fields: {} })),
}))

const { clearMediaCache } = await import('@/shared/settings/media')
const { checkUploadsCors, setupUploadsCors, UPLOADS_CORS_RULE_ID } = await import('@/shared/media/uploads-cors')

const ORIGIN = 'https://setfork.com'
const S3 = { S3_ENDPOINT: 'https://s3.test', S3_BUCKET: 'b', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 's' }
const saved = Object.fromEntries(Object.keys(S3).map((k) => [k, process.env[k]]))

beforeEach(() => {
  Object.assign(process.env, S3)
  clearMediaCache()
  store.rules = []
  store.put = []
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  clearMediaCache()
})

describe('setupUploadsCors', () => {
  it('чужие правила целы, своё (по ID) заменено свежим', async () => {
    const foreign: CORSRule = { ID: 'cdn', AllowedOrigins: ['https://cdn.example'], AllowedMethods: ['GET'] }
    const stale: CORSRule = { ID: UPLOADS_CORS_RULE_ID, AllowedOrigins: ['https://old.example'], AllowedMethods: ['POST'] }
    store.rules = [foreign, stale]
    expect(await setupUploadsCors(ORIGIN)).toEqual({ ok: true, rules: 2 })
    const [written] = store.put
    expect(written).toContainEqual(foreign)
    const mine = written.filter((r) => r.ID === UPLOADS_CORS_RULE_ID)
    expect(mine).toEqual([
      { ID: UPLOADS_CORS_RULE_ID, AllowedOrigins: [ORIGIN], AllowedMethods: ['POST'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3000 },
    ])
  })

  it('без S3 — storage_unavailable, в хранилище не пишем', async () => {
    delete process.env.S3_BUCKET
    clearMediaCache()
    expect(await setupUploadsCors(ORIGIN)).toEqual({ ok: false, reason: 'storage_unavailable' })
    expect(store.put).toHaveLength(0)
  })
})

describe('checkUploadsCors', () => {
  const answer = (status: number, headers: Record<string, string> = {}) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status, headers })))

  it('предзапрос как у браузера: OPTIONS на адрес политики с Origin сайта', async () => {
    answer(200, { 'Access-Control-Allow-Origin': ORIGIN })
    expect(await checkUploadsCors(ORIGIN)).toEqual({ ok: true })
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://setfork-uploads.s3.test/')
    expect(init.method).toBe('OPTIONS')
    expect(init.headers).toMatchObject({ Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' })
  })

  it('403/405 — status с кодом', async () => {
    answer(405)
    expect(await checkUploadsCors(ORIGIN)).toEqual({ ok: false, reason: 'status', status: 405 })
  })

  it('200 без Access-Control-Allow-Origin (или чужой origin) — no_allow_origin', async () => {
    answer(200)
    expect(await checkUploadsCors(ORIGIN)).toMatchObject({ ok: false, reason: 'no_allow_origin' })
    answer(200, { 'Access-Control-Allow-Origin': 'https://evil.example' })
    expect(await checkUploadsCors(ORIGIN)).toMatchObject({ ok: false, reason: 'no_allow_origin' })
  })

  it('ошибка TLS (сертификат не покрывает имя с точкой) — tls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } })
      }),
    )
    expect(await checkUploadsCors(ORIGIN)).toEqual({ ok: false, reason: 'tls', detail: 'ERR_TLS_CERT_ALTNAME_INVALID' })
  })

  it('прочий обрыв — network с кодом', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
      }),
    )
    expect(await checkUploadsCors(ORIGIN)).toEqual({ ok: false, reason: 'network', detail: 'ENOTFOUND' })
  })
})
