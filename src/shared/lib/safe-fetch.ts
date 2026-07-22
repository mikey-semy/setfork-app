import 'server-only'
import { lookup } from 'node:dns/promises'

// SSRF-безопасный fetch пользовательских URL — единая точка (чокпоинт, как safeHref
// для ссылок). Две дыры обычного fetch(url, { redirect: 'follow' }):
//  1) redirect-hop: публичный URL 302-редиректит на http://169.254.169.254/… или
//     внутренний хост — 'follow' уходит туда без проверки;
//  2) DNS-rebind по имени: публичное имя резолвится в 127.0.0.1/10.x — regex по
//     hostname этого не видит.
// Здесь редиректы идём вручную (каждый хоп заново валидируется), а хост резолвим
// через DNS и проверяем ВСЕ адреса против приватных/служебных диапазонов.
// Остаточный риск — TOCTOU (повторный резолв между проверкой и соединением);
// полное закрытие требует пиннинга IP на уровне undici-dispatcher'а — осознанно
// не усложняем, планка и так поднята с «любой redirect» до «нужен fast-flux DNS».

/** Быстрый префильтр по hostname (литеральные локальные формы). DNS-проверка — авторитет. */
const PRIVATE_HOST_RE =
  /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0$|::1$|\[::1\]$|172\.(1[6-9]|2\d|3[01])\.)/i

/** Приватный/служебный IP (v4 и v6, включая v4-mapped). Не-IP → true (fail closed). */
export function isPrivateIp(ip: string): boolean {
  const s = ip.toLowerCase().trim()
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) // v4-mapped IPv6
  if (mapped) return isPrivateIp(mapped[1])
  if (s.includes(':')) {
    if (s === '::' || s === '::1') return true // unspecified / loopback
    return /^(fe[89ab]|f[cd])/.test(s) // link-local fe80::/10, ULA fc00::/7
  }
  const p = s.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10/8
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 CGN
    (a === 169 && b === 254) || // link-local (cloud metadata)
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12
    (a === 192 && b === 168) || // 192.168/16
    a >= 224 // multicast + reserved + broadcast
  )
}

/** Причина отказа/сбоя fetchPublicUrlDetailed — link-checker'у важно различать
 *  «домена нет» (dns → кандидат в битые) и «сеть не пустила» (net → недостижимо
 *  с нашего egress, у RU-сервера это сплошь ТСПУ — НЕ значит «мертво»). */
export type SafeFetchReason = 'bad_url' | 'private' | 'dns' | 'net' | 'too_many_redirects'

/** Хост публичен? 'ok' | 'private' (приватные адреса/имена) | 'dns' (не резолвится). */
async function checkPublicHost(hostname: string): Promise<'ok' | 'private' | 'dns'> {
  const host = hostname.replace(/^\[|\]$/g, '') // IPv6 в URL приходит в скобках
  if (PRIVATE_HOST_RE.test(hostname) || PRIVATE_HOST_RE.test(host)) return 'private'
  try {
    const addrs = await lookup(host, { all: true })
    if (!addrs.length) return 'dns'
    return addrs.every((a) => !isPrivateIp(a.address)) ? 'ok' : 'private'
  } catch {
    return 'dns' // резолв не удался (NXDOMAIN/сбой резолвера) — не ходим
  }
}

export interface SafeFetchDetailed {
  res: Response | null
  reason?: SafeFetchReason
  /** URL, на котором закончили (после редиректов) — для «страница переехала». */
  finalUrl?: string
}

/**
 * fetch по недоверенному URL с причиной отказа: только http/https, хост каждого
 * хопа проверяется, редиректы идём вручную (до maxRedirects).
 */
export async function fetchPublicUrlDetailed(input: URL | string, init: RequestInit = {}, maxRedirects = 3): Promise<SafeFetchDetailed> {
  let u: URL
  try {
    u = typeof input === 'string' ? new URL(input) : input
  } catch {
    return { res: null, reason: 'bad_url' }
  }
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { res: null, reason: 'bad_url' }
    const host = await checkPublicHost(u.hostname)
    if (host !== 'ok') return { res: null, reason: host }
    let res: Response
    try {
      res = await fetch(u, { ...init, redirect: 'manual' })
    } catch {
      // timeout/reset/tls/прочая сеть — уже после успешного резолва
      return { res: null, reason: 'net', finalUrl: u.toString() }
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      res.body?.cancel().catch(() => {}) // освобождаем сокет недочитанного редиректа
      if (!loc) return { res: null, reason: 'net', finalUrl: u.toString() }
      try {
        u = new URL(loc, u) // относительный Location — против текущего хопа
      } catch {
        return { res: null, reason: 'bad_url' }
      }
      continue
    }
    return { res, finalUrl: u.toString() }
  }
  return { res: null, reason: 'too_many_redirects' }
}

/**
 * fetch по недоверенному URL: null = отказано/ошибка сети (без причины —
 * прежний контракт; за причиной — fetchPublicUrlDetailed).
 */
export async function fetchPublicUrl(input: URL | string, init: RequestInit = {}, maxRedirects = 3): Promise<Response | null> {
  return (await fetchPublicUrlDetailed(input, init, maxRedirects)).res
}
