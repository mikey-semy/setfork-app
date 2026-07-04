import { describe, expect, it, vi } from 'vitest'
import { rateLimit } from './rate-limit'

describe('rateLimit — fixed window', () => {
  it('allows up to the limit, then blocks', () => {
    const key = `t-${Math.random()}`
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3, 60_000).ok).toBe(true)
    const blocked = rateLimit(key, 3, 60_000)
    expect(blocked.ok).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.retryAfter).toBeGreaterThan(0)
  })

  it('separate keys have independent budgets', () => {
    const a = `a-${Math.random()}`
    const b = `b-${Math.random()}`
    expect(rateLimit(a, 1, 60_000).ok).toBe(true)
    expect(rateLimit(a, 1, 60_000).ok).toBe(false)
    expect(rateLimit(b, 1, 60_000).ok).toBe(true) // b не задет
  })

  it('resets after the window elapses', () => {
    // Fake-таймеры: детерминированно, без гонки на границе миллисекунды
    // (при реальном окне 1мс два синхронных вызова могли «перешагнуть» мс и сбросить счётчик).
    vi.useFakeTimers()
    try {
      const key = `w-${Math.random()}`
      expect(rateLimit(key, 1, 1000).ok).toBe(true)
      expect(rateLimit(key, 1, 1000).ok).toBe(false)
      vi.advanceTimersByTime(1001) // окно прошло
      expect(rateLimit(key, 1, 1000).ok).toBe(true) // снова можно
    } finally {
      vi.useRealTimers()
    }
  })
})
