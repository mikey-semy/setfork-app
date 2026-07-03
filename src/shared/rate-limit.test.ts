import { describe, expect, it } from 'vitest'
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
    const key = `w-${Math.random()}`
    expect(rateLimit(key, 1, 1).ok).toBe(true) // окно 1мс
    expect(rateLimit(key, 1, 1).ok).toBe(false)
    return new Promise<void>((res) =>
      setTimeout(() => {
        expect(rateLimit(key, 1, 1).ok).toBe(true) // окно прошло → снова можно
        res()
      }, 5),
    )
  })
})
