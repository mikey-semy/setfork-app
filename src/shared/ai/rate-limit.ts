import 'server-only'
import { rateStore } from '@/shared/rate-limit-store'

// Token-bucket поверх пуллинг-бэкенда (in-memory или Redis). Burst до CAPACITY,
// восполнение REFILL_PER_SEC/сек (~5/мин). async — Redis async; на 1 инстансе
// бэкенд in-memory, поведение прежнее.
const CAPACITY = 5
const REFILL_PER_SEC = 5 / 60 // ~5/min sustained

export function checkRateLimit(key: string): Promise<{ allowed: boolean; retryAfter: number }> {
  return rateStore().tokenBucket(key, CAPACITY, REFILL_PER_SEC)
}
