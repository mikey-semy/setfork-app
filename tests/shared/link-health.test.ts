import { beforeEach, describe, expect, it, vi } from 'vitest'

// Мокаем SSRF-чокпоинт (safe-fetch), а не голый fetch: link-health ходит только
// через него (иначе редирект-хоп мог увести на 169.254.169.254), и юнит-тест
// не должен зависеть от реального DNS-резолва фейковых доменов.
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<{ res: { status: number; body?: undefined } | null; reason?: string }>>()
vi.mock('@/shared/lib/safe-fetch', () => ({
  fetchPublicUrlDetailed: (url: string, init?: RequestInit) => fetchMock(url, init),
}))

const { checkUrl, classifyStatus, filterDeadRefs } = await import('@/shared/lib/link-health')

beforeEach(() => fetchMock.mockReset())

const byStatus = (impl: (url: string, init?: RequestInit) => number) =>
  fetchMock.mockImplementation(async (url, init) => ({ res: { status: impl(url, init) } }))

describe('classifyStatus', () => {
  it('мёртвая — только уверенная смерть (404/410)', () => {
    expect(classifyStatus(404)).toBe('dead')
    expect(classifyStatus(410)).toBe('dead')
  })
  it('2xx/3xx — живая', () => {
    expect(classifyStatus(200)).toBe('ok')
    expect(classifyStatus(301)).toBe('ok')
  })
  it('бот-защита/лимиты/5xx — unknown, не сорняк (RU-сервер может не достучаться)', () => {
    for (const s of [401, 403, 429, 500, 503]) expect(classifyStatus(s)).toBe('unknown')
  })
})

describe('checkUrl', () => {
  it('HEAD 405 → перепроверка GET-ом', async () => {
    byStatus((_url, init) => (init?.method === 'HEAD' ? 405 : 200))
    expect(await checkUrl('https://example.com/x')).toBe('ok')
  })
  it('SSRF-отказ / несуществующий домен / сеть → unknown', async () => {
    fetchMock.mockResolvedValue({ res: null, reason: 'dns' })
    expect(await checkUrl('https://dead-domain.example/x')).toBe('unknown')
    fetchMock.mockResolvedValue({ res: null, reason: 'net' })
    expect(await checkUrl('https://blocked.example/x')).toBe('unknown')
  })
  it('не-HTTP не проверяем', async () => {
    byStatus(() => 200)
    expect(await checkUrl('mailto:a@b.c')).toBe('unknown')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('filterDeadRefs', () => {
  it('выкидывает только dead, unknown остаётся; возвращает число удалённых', async () => {
    byStatus((url) => (String(url).includes('dead') ? 404 : String(url).includes('slow') ? 503 : 200))
    const items = [
      { refs: [{ url: 'https://ok.example/a' }, { url: 'https://dead.example/b' }] },
      { refs: [{ url: 'https://slow.example/c' }] },
      { refs: [] },
    ]
    const removed = await filterDeadRefs(items)
    expect(removed).toBe(1)
    expect(items[0].refs.map((r) => r.url)).toEqual(['https://ok.example/a'])
    expect(items[1].refs).toHaveLength(1)
  })
})
