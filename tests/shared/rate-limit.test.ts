import { describe, expect, it, vi } from 'vitest'
import { rateLimit } from '@/shared/rate-limit'

// rateLimit теперь async (бэкенд in-memory | Redis). Без REDIS_URL — in-memory,
// поведение прежнее; тесты проверяют именно его.
describe('rateLimit — fixed window (in-memory)', () => {
  it('allows up to the limit, then blocks', async () => {
    const key = `t-${Math.random()}`
    for (let i = 0; i < 3; i++) expect((await rateLimit(key, 3, 60_000)).ok).toBe(true)
    const blocked = await rateLimit(key, 3, 60_000)
    expect(blocked.ok).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.retryAfter).toBeGreaterThan(0)
  })

  it('separate keys have independent budgets', async () => {
    const a = `a-${Math.random()}`
    const b = `b-${Math.random()}`
    expect((await rateLimit(a, 1, 60_000)).ok).toBe(true)
    expect((await rateLimit(a, 1, 60_000)).ok).toBe(false)
    expect((await rateLimit(b, 1, 60_000)).ok).toBe(true) // b не задет
  })

  it('resets after the window elapses', async () => {
    vi.useFakeTimers()
    try {
      const key = `w-${Math.random()}`
      expect((await rateLimit(key, 1, 1000)).ok).toBe(true)
      expect((await rateLimit(key, 1, 1000)).ok).toBe(false)
      vi.advanceTimersByTime(1001) // окно прошло
      expect((await rateLimit(key, 1, 1000)).ok).toBe(true) // снова можно
    } finally {
      vi.useRealTimers()
    }
  })
})
