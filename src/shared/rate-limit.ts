import 'server-only'
import { rateStore, type FixedWindowResult } from './rate-limit-store'

// Фиксированное окно поверх пуллинг-бэкенда (in-memory или Redis, см. rate-limit-store).
// async — потому что Redis async; на 1 инстансе бэкенд in-memory, поведение прежнее.

export type RateResult = FixedWindowResult

/** Учитывает попытку под ключом `key`. `limit` попыток за `windowMs`. */
export function rateLimit(key: string, limit: number, windowMs: number): Promise<RateResult> {
  return rateStore().fixedWindow(key, limit, windowMs)
}

/**
 * ДВА КЛЮЧА НА ОДНО ДЕЙСТВИЕ: свой у человека и свой у места, куда он пишет.
 *
 * Форма взята у GitLab (лимит независимо на проект и на пользователя) и жила копией в
 * задачах. С обсуждениями копий стало бы две, а расходятся они тихо: поправят порог в
 * одной, забудут в другой — и раздел, о котором забыли, снова принимает скрипт в цикле.
 *
 * ⚠️ ОБА СЧЁТЧИКА СЧИТАЕМ ВСЕГДА, а не «пока не откажет»: иначе при частых обращениях
 * одного человека счётчик места отстаёт и порог по нему не наступает никогда.
 *
 * Сами ЧИСЛА сюда не переезжают — они выводятся из картины своего раздела и живут рядом
 * с ним (см. `features/issues/limits.ts`, `features/discussions/limits.ts`).
 */
export async function underTwoKeyRate(
  user: { key: string; limit: number },
  place: { key: string; limit: number },
  windowMs: number,
): Promise<boolean> {
  const [byUser, byPlace] = await Promise.all([
    rateLimit(user.key, user.limit, windowMs),
    rateLimit(place.key, place.limit, windowMs),
  ])
  return byUser.ok && byPlace.ok
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
