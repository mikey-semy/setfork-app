import { describe, expect, it } from 'vitest'
import { tokenExpired } from './api-token'

describe('tokenExpired', () => {
  it('null/undefined never expires', () => {
    expect(tokenExpired(null)).toBe(false)
    expect(tokenExpired(undefined)).toBe(false)
  })
  it('past expiry → expired', () => {
    expect(tokenExpired(new Date(1000), 2000)).toBe(true)
  })
  it('future expiry → valid', () => {
    expect(tokenExpired(new Date(5000), 2000)).toBe(false)
  })
})
