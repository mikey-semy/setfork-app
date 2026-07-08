import 'server-only'
import Redis from 'ioredis'
import { captureError } from './observability'

// Бэкенд rate-limit: in-memory (дефолт, для 1 инстанса) ИЛИ Redis (мульти-инстанс,
// если задан REDIS_URL). Единый async-интерфейс: Redis по-другому нельзя. Поведение
// in-memory 1:1 с прежними лимитерами, так что на одном хосте ничего не меняется.
// Redis-ошибки НЕ роняют сайт: fail-open (пропускаем) + лог — временный сбой Redis
// не должен блокировать всех.

export interface FixedWindowResult {
  ok: boolean
  remaining: number
  retryAfter: number
}
export interface BucketResult {
  allowed: boolean
  retryAfter: number
}

export interface RateStore {
  /** Фиксированное окно: `limit` попыток за `windowMs`. */
  fixedWindow(key: string, limit: number, windowMs: number): Promise<FixedWindowResult>
  /** Token-bucket: burst до `capacity`, восполнение `refillPerSec`/сек. */
  tokenBucket(key: string, capacity: number, refillPerSec: number): Promise<BucketResult>
}

// ── In-memory (порт прежней логики, обёрнутой в async) ────────────────
type Window = { count: number; reset: number }
type Bucket = { tokens: number; last: number }

class MemoryStore implements RateStore {
  private windows = new Map<string, Window>()
  private buckets = new Map<string, Bucket>()

  async fixedWindow(key: string, limit: number, windowMs: number): Promise<FixedWindowResult> {
    const now = Date.now()
    if (this.windows.size > 5000) for (const [k, w] of this.windows) if (w.reset <= now) this.windows.delete(k)
    let w = this.windows.get(key)
    if (!w || w.reset <= now) {
      w = { count: 0, reset: now + windowMs }
      this.windows.set(key, w)
    }
    w.count++
    return { ok: w.count <= limit, remaining: Math.max(0, limit - w.count), retryAfter: Math.max(1, Math.ceil((w.reset - now) / 1000)) }
  }

  async tokenBucket(key: string, capacity: number, refillPerSec: number): Promise<BucketResult> {
    const now = Date.now()
    const b = this.buckets.get(key) ?? { tokens: capacity, last: now }
    b.tokens = Math.min(capacity, b.tokens + ((now - b.last) / 1000) * refillPerSec)
    b.last = now
    if (b.tokens >= 1) {
      b.tokens -= 1
      this.buckets.set(key, b)
      return { allowed: true, retryAfter: 0 }
    }
    this.buckets.set(key, b)
    return { allowed: false, retryAfter: Math.ceil((1 - b.tokens) / refillPerSec) }
  }
}

// ── Redis (атомарно через Lua; общий на все инстансы) ─────────────────
// INCR + PEXPIRE на первом попадании — атомарно, чтобы окно не «протекало».
const FIXED_LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1])) end
return {c, redis.call('PTTL', KEYS[1])}`

// Классический token-bucket: {tokens, ts} в хэше, восполнение по времени.
const BUCKET_LUA = `
local d = redis.call('HMGET', KEYS[1], 't', 's')
local cap = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local tokens = tonumber(d[1])
local ts = tonumber(d[2])
if tokens == nil then tokens = cap; ts = now end
tokens = math.min(cap, tokens + ((now - ts) / 1000) * refill)
local allowed = 0
local retry = 0
if tokens >= 1 then tokens = tokens - 1; allowed = 1 else retry = math.ceil((1 - tokens) / refill) end
redis.call('HMSET', KEYS[1], 't', tokens, 's', now)
redis.call('PEXPIRE', KEYS[1], math.ceil((cap / refill) * 1000) + 1000)
return {allowed, retry}`

export class RedisStore implements RateStore {
  constructor(private redis: Redis) {}

  async fixedWindow(key: string, limit: number, windowMs: number): Promise<FixedWindowResult> {
    try {
      const [c, ttl] = (await this.redis.eval(FIXED_LUA, 1, `rl:fw:${key}`, String(windowMs))) as [number, number]
      return { ok: c <= limit, remaining: Math.max(0, limit - c), retryAfter: Math.max(1, Math.ceil(ttl / 1000)) }
    } catch (e) {
      captureError(e, { where: 'rate-limit.redis.fixedWindow' })
      return { ok: true, remaining: limit, retryAfter: 0 } // fail-open: сбой Redis не блокирует
    }
  }

  async tokenBucket(key: string, capacity: number, refillPerSec: number): Promise<BucketResult> {
    try {
      const [allowed, retry] = (await this.redis.eval(BUCKET_LUA, 1, `rl:tb:${key}`, String(capacity), String(refillPerSec), String(Date.now()))) as [number, number]
      return { allowed: allowed === 1, retryAfter: retry }
    } catch (e) {
      captureError(e, { where: 'rate-limit.redis.tokenBucket' })
      return { allowed: true, retryAfter: 0 } // fail-open
    }
  }
}

// Синглтон (переживает HMR, переиспользует соединение) — как пул pg.
declare global {
  var __rateStore: RateStore | undefined
}

function makeStore(): RateStore {
  const url = process.env.REDIS_URL
  if (!url) return new MemoryStore()
  const redis = new Redis(url, { maxRetriesPerRequest: 2, enableOfflineQueue: false })
  redis.on('error', (e) => captureError(e, { where: 'rate-limit.redis.conn' }))
  return new RedisStore(redis)
}

export function rateStore(): RateStore {
  return (globalThis.__rateStore ??= makeStore())
}
