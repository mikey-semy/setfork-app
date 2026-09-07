import 'server-only'
import { rateStore, type FixedWindowResult } from './rate-limit-store'

// Фиксированное окно поверх пуллинг-бэкенда (in-memory или Redis, см. rate-limit-store).
// async — потому что Redis async; на 1 инстансе бэкенд in-memory, поведение прежнее.

export type RateResult = FixedWindowResult

/** Учитывает попытку под ключом `key`. `limit` попыток за `windowMs`. */
export function rateLimit(key: string, limit: number, windowMs: number): Promise<RateResult> {
  return rateStore().fixedWindow(key, limit, windowMs)
}

/** IP клиента из заголовков прокси (Traefik). */
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
