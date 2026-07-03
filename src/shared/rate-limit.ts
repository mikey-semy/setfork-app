// Лёгкий in-memory rate-limiter (фиксированное окно). Достаточно для одного инстанса;
// для мульти-инстанс-прода заменить на Redis/Upstash (тот же интерфейс).

type Bucket = { count: number; reset: number }
const store = new Map<string, Bucket>()

function prune(now: number) {
  for (const [k, b] of store) if (b.reset <= now) store.delete(k)
}

export type RateResult = { ok: boolean; remaining: number; retryAfter: number }

/** Учитывает попытку под ключом `key`. `limit` попыток за `windowMs`. */
export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now()
  if (store.size > 5000) prune(now)
  let b = store.get(key)
  if (!b || b.reset <= now) {
    b = { count: 0, reset: now + windowMs }
    store.set(key, b)
  }
  b.count++
  return {
    ok: b.count <= limit,
    remaining: Math.max(0, limit - b.count),
    retryAfter: Math.max(1, Math.ceil((b.reset - now) / 1000)),
  }
}

/** IP клиента из заголовков прокси (Traefik/dokploy). */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

/** Ответ 429 с Retry-After. */
export function tooMany(r: RateResult): Response {
  return Response.json(
    { error: 'rate_limited', retryAfter: r.retryAfter },
    { status: 429, headers: { 'Retry-After': String(r.retryAfter) } },
  )
}
