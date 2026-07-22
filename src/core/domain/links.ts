// Ссылки в контенте списков: нормализация и харвест — чистый домен (без
// Next/Drizzle/fetch), юнит-тестируется. Потребитель — link-checker (Ж1):
// нормализованный URL — глобальный ключ дедупликации проб.

const MAX_URL_LEN = 2048

/** Нормализовать URL для дедупликации: без #fragment, scheme/host в нижнем
 *  регистре, дефолтный порт убран, хвостовой «/» у голого пути срезан.
 *  Query СОХРАНЯЕТСЯ (это другой ресурс). null — не http(s) или мусор. */
export function normalizeUrl(raw: string): string | null {
  const s = raw.trim()
  if (!s || s.length > MAX_URL_LEN) return null
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  u.hash = ''
  u.hostname = u.hostname.toLowerCase()
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = ''
  let out = u.toString()
  if (u.pathname === '/' && !u.search) out = out.replace(/\/$/, '')
  return out.slice(0, MAX_URL_LEN)
}

/** Хост нормализованного URL ('' — если не парсится). */
export function urlHost(urlNorm: string): string {
  try {
    return new URL(urlNorm).hostname
  } catch {
    return ''
  }
}

// Полные URL из свободного текста (markdown/desc): тот же подход, что
// extractHosts в модерации (regex + чистка хвостовой пунктуации), но URL
// целиком. Скобка ')' срезается только незакрытая — markdown-ссылки
// `[x](https://a/b_(c))` встречаются редко, а хвост `…)` после URL — часто.
const URL_RE = /https?:\/\/[^\s<>"'`\][]+/gi

export function extractUrls(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(URL_RE)) {
    let u = m[0]
    // хвостовая пунктуация предложения — не часть URL
    u = u.replace(/[.,;:!?]+$/, '')
    // незакрытые скобки markdown/предложения
    while (u.endsWith(')') && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) u = u.slice(0, -1)
    if (u) out.push(u)
  }
  return out
}

/** Все строковые листья произвольного JSON (блочный content, subtasks, …) —
 *  та же семантика, что contentStrings в модерации: инлайн-ссылки в markdown
 *  без этого обхода были бы пропущены харвестером. */
export function walkStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') {
    if (v) out.push(v)
  } else if (Array.isArray(v)) {
    for (const x of v) walkStrings(x, out)
  } else if (v && typeof v === 'object') {
    for (const x of Object.values(v)) walkStrings(x, out)
  }
  return out
}
