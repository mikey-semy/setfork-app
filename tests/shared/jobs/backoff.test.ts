import { describe, it, expect } from 'vitest'
import { backoffMs } from '@/shared/jobs/backoff'

describe('backoffMs', () => {
  it('grows exponentially from attempt count', () => {
    expect(backoffMs(0)).toBe(1000)
    expect(backoffMs(1)).toBe(2000)
    expect(backoffMs(2)).toBe(4000)
    expect(backoffMs(5)).toBe(32000)
  })

  it('caps at 5 minutes', () => {
    expect(backoffMs(20)).toBe(5 * 60_000)
    expect(backoffMs(1000)).toBe(5 * 60_000)
  })

  it('treats negative attempts as 0', () => {
    expect(backoffMs(-3)).toBe(1000)
  })
})
