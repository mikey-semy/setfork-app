import Redis from 'ioredis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RedisStore } from './rate-limit-store'

// Проверка Redis-бэкенда против НАСТОЯЩЕГО Redis (Lua fixedWindow/tokenBucket).
// Запускается только если задан REDIS_URL (иначе пропуск — обычный CI без Redis).
// Локально: docker run -p 6390:6379 redis; REDIS_URL=redis://localhost:6390 vitest.
const URL = process.env.REDIS_URL

describe.skipIf(!URL)('RedisStore (нужен REDIS_URL)', () => {
  let redis: Redis
  let store: RedisStore

  beforeAll(() => {
    redis = new Redis(URL as string)
    store = new RedisStore(redis)
  })
  afterAll(async () => {
    await redis.quit()
  })

  it('fixedWindow: до лимита ok, потом блок; TTL/retryAfter выставлен', async () => {
    const key = `fw-${Math.random()}`
    for (let i = 0; i < 3; i++) expect((await store.fixedWindow(key, 3, 60_000)).ok).toBe(true)
    const blocked = await store.fixedWindow(key, 3, 60_000)
    expect(blocked.ok).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.retryAfter).toBeGreaterThan(0)
  })

  it('fixedWindow: разные ключи независимы', async () => {
    const a = `fwa-${Math.random()}`
    const b = `fwb-${Math.random()}`
    expect((await store.fixedWindow(a, 1, 60_000)).ok).toBe(true)
    expect((await store.fixedWindow(a, 1, 60_000)).ok).toBe(false)
    expect((await store.fixedWindow(b, 1, 60_000)).ok).toBe(true)
  })

  it('tokenBucket: burst до capacity, затем блок с retryAfter', async () => {
    const key = `tb-${Math.random()}`
    for (let i = 0; i < 5; i++) expect((await store.tokenBucket(key, 5, 5 / 60)).allowed).toBe(true)
    const blocked = await store.tokenBucket(key, 5, 5 / 60)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfter).toBeGreaterThan(0)
  })
})
