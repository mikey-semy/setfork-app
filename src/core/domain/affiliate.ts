// Партнёрские (affiliate) правила: «домен → query-параметр». Чистый домен —
// без Next/Drizzle/fetch; правила задаёт админ (см. shared/settings/monetization),
// подстановка происходит на исходящем редиректе /api/go.

export type AffiliateRule = {
  match: string // суффикс хоста без схемы/порта ('amazon.com' матчит и www.amazon.com)
  param: string // имя query-параметра ('tag')
  value: string // значение ('setfork-20')
}

export const MAX_AFFILIATE_RULES = 50

/** Разбор правил из JSON (textarea/hidden-input админки): мусорные записи
 *  молча отбрасываем, хосты нормализуем ('*.', 'www.', регистр). */
export function parseAffiliateRules(json: string): AffiliateRule[] {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const out: AffiliateRule[] = []
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue
    const { match, param, value } = r as Record<string, unknown>
    if (typeof match !== 'string' || typeof param !== 'string' || typeof value !== 'string') continue
    const host = match.trim().toLowerCase().replace(/^\*\.?/, '').replace(/^www\./, '')
    const p = param.trim()
    const v = value.trim()
    if (!host || !host.includes('.') || host.includes('/') || !p || !v) continue
    out.push({ match: host, param: p, value: v })
    if (out.length >= MAX_AFFILIATE_RULES) break
  }
  return out
}

/** Хост подпадает под правило: точное совпадение или поддомен (граница — точка),
 *  чтобы 'amazon.com' НЕ матчил 'notamazon.com'. */
export function hostMatches(host: string, match: string): boolean {
  const h = host.toLowerCase()
  return h === match || h.endsWith('.' + match)
}

/** Первое подходящее правило для URL (или null). Невалидный URL — null. */
export function findAffiliateRule(url: string, rules: AffiliateRule[]): AffiliateRule | null {
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return null
  }
  return rules.find((r) => hostMatches(host, r.match)) ?? null
}

/** Подставить партнёрский параметр. Существующий параметр перезаписываем —
 *  тег площадки приоритетнее принесённого в ссылке. Только http/https. */
export function applyAffiliate(url: string, rules: AffiliateRule[]): { url: string; tagged: boolean } {
  const rule = findAffiliateRule(url, rules)
  if (!rule) return { url, tagged: false }
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { url, tagged: false }
    u.searchParams.set(rule.param, rule.value)
    return { url: u.toString(), tagged: true }
  } catch {
    return { url, tagged: false }
  }
}

/** Есть ли среди ссылок хотя бы одна партнёрская — триггер FTC-плашки списка. */
export function hasAffiliateLink(urls: (string | undefined)[], rules: AffiliateRule[]): boolean {
  if (rules.length === 0) return false
  return urls.some((u) => !!u && findAffiliateRule(u, rules) !== null)
}
