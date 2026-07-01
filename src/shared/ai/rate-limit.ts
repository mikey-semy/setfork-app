import 'server-only'

// In-memory token-bucket. Bursts up to CAPACITY, refills at REFILL_PER_SEC.
interface Bucket {
  tokens: number
  last: number
}

const CAPACITY = 5
const REFILL_PER_SEC = 5 / 60 // ~5/min sustained
const buckets = new Map<string, Bucket>()

export function checkRateLimit(key: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now()
  const b = buckets.get(key) ?? { tokens: CAPACITY, last: now }
  const elapsed = (now - b.last) / 1000
  b.tokens = Math.min(CAPACITY, b.tokens + elapsed * REFILL_PER_SEC)
  b.last = now
  if (b.tokens >= 1) {
    b.tokens -= 1
    buckets.set(key, b)
    return { allowed: true, retryAfter: 0 }
  }
  buckets.set(key, b)
  return { allowed: false, retryAfter: Math.ceil((1 - b.tokens) / REFILL_PER_SEC) }
}
