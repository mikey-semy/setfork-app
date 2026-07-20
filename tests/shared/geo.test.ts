import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lookupGeo } from '@/shared/geo'

let savedProvider: string | undefined

beforeEach(() => {
  savedProvider = process.env.GEO_PROVIDER
  delete process.env.GEO_PROVIDER
})

afterEach(() => {
  if (savedProvider === undefined) delete process.env.GEO_PROVIDER
  else process.env.GEO_PROVIDER = savedProvider
  vi.restoreAllMocks()
})

describe('lookupGeo', () => {
  it('без GEO_PROVIDER выключен: null даже для публичного IP, сеть не трогаем', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    expect(await lookupGeo('8.8.8.8')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('с провайдером приватные/пустые IP по-прежнему null без сети', async () => {
    process.env.GEO_PROVIDER = 'ipwhois'
    const spy = vi.spyOn(globalThis, 'fetch')
    expect(await lookupGeo('192.168.1.10')).toBeNull()
    expect(await lookupGeo('10.0.0.1')).toBeNull()
    expect(await lookupGeo(null)).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('с провайдером публичный IP идёт в ipwho.is (fetch мокнут)', async () => {
    process.env.GEO_PROVIDER = 'ipwhois'
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, city: 'Berlin', country_code: 'DE' }), { status: 200 }),
    )
    expect(await lookupGeo('8.8.8.8')).toBe('Berlin, DE')
    expect(spy).toHaveBeenCalledOnce()
  })
})
