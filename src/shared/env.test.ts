import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateEnv } from './env'

afterEach(() => vi.unstubAllEnvs())

describe('validateEnv', () => {
  it('throws when a required var is missing', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://x')
    vi.stubEnv('AUTH_SECRET', '')
    expect(() => validateEnv()).toThrow(/AUTH_SECRET/)
  })

  it('passes in dev when required vars are set', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://x')
    vi.stubEnv('AUTH_SECRET', 'dev')
    vi.stubEnv('NODE_ENV', 'development')
    expect(() => validateEnv()).not.toThrow()
  })

  it('rejects a short AUTH_SECRET in production', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://x')
    vi.stubEnv('AUTH_SECRET', 'short')
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => validateEnv()).toThrow(/AUTH_SECRET/)
  })
})
