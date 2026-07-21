import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkUrl, classifyStatus, filterDeadRefs } from '@/shared/lib/link-health'

afterEach(() => vi.unstubAllGlobals())

const stubFetch = (impl: (url: string, init?: RequestInit) => Promise<{ status: number }>) => {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn as unknown as typeof fetch)
  return fn
}

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
    stubFetch(async (_url, init) => ({ status: init?.method === 'HEAD' ? 405 : 200 }))
    expect(await checkUrl('https://example.com/x')).toBe('ok')
  })
  it('сетевая ошибка → unknown', async () => {
    stubFetch(async () => {
      throw new Error('ECONNREFUSED')
    })
    expect(await checkUrl('https://example.com/x')).toBe('unknown')
  })
  it('не-HTTP не проверяем', async () => {
    const spy = stubFetch(async () => ({ status: 200 }))
    expect(await checkUrl('mailto:a@b.c')).toBe('unknown')
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('filterDeadRefs', () => {
  it('выкидывает только dead, unknown остаётся; возвращает число удалённых', async () => {
    stubFetch(async (url) => ({ status: String(url).includes('dead') ? 404 : String(url).includes('slow') ? 503 : 200 }))
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
