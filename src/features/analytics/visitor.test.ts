import { afterEach, describe, expect, it, vi } from 'vitest'
import { dayUtc, isBot, visitorKey } from './visitor'

afterEach(() => vi.unstubAllEnvs())

describe('isBot', () => {
  it('считает ботом пустой UA и известные сигнатуры', () => {
    expect(isBot(null)).toBe(true)
    expect(isBot('')).toBe(true)
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true)
    expect(isBot('curl/8.5.0')).toBe(true)
    expect(isBot('python-requests/2.32')).toBe(true)
  })
  it('пропускает обычные браузеры', () => {
    expect(isBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36')).toBe(false)
  })
})

describe('dayUtc', () => {
  it('возвращает дату UTC без времени', () => {
    expect(dayUtc(new Date('2026-07-08T23:59:59.999Z'))).toBe('2026-07-08')
    expect(dayUtc(new Date('2026-07-08T00:00:00.000Z'))).toBe('2026-07-08')
  })
})

describe('visitorKey', () => {
  const UA = 'Mozilla/5.0 Chrome/126'

  it('вошедший — стабильный u:<id> независимо от ip/ua', () => {
    expect(visitorKey('abc', '1.2.3.4', UA)).toBe('u:abc')
    expect(visitorKey('abc', '5.6.7.8', null)).toBe('u:abc')
  })

  it('аноним — детерминированный хеш от ip|ua в пределах дня', () => {
    vi.stubEnv('AUTH_SECRET', 's3cret')
    const a = visitorKey(null, '1.2.3.4', UA, '2026-07-08')
    expect(a).toBe(visitorKey(null, '1.2.3.4', UA, '2026-07-08'))
    expect(a).toMatch(/^a:[0-9a-f]{32}$/)
  })

  it('хеш анонима ротируется по дням и различает ip/ua', () => {
    vi.stubEnv('AUTH_SECRET', 's3cret')
    const base = visitorKey(null, '1.2.3.4', UA, '2026-07-08')
    expect(visitorKey(null, '1.2.3.4', UA, '2026-07-09')).not.toBe(base)
    expect(visitorKey(null, '9.9.9.9', UA, '2026-07-08')).not.toBe(base)
    expect(visitorKey(null, '1.2.3.4', 'other', '2026-07-08')).not.toBe(base)
  })
})
