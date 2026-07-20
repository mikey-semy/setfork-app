import 'server-only'

// Гео по IP для «Seen in …» у сессий (как GitHub). ОПЦИОНАЛЬНО: без
// GEO_PROVIDER=ipwhois гео выключено (дефолт) и «Seen in …» просто пуст —
// IP пользователя никуда не уходит. На RU-проде НЕ включать: ipwho.is —
// зарубежный сервис, IP туда = трансграничная передача ПДн (152-ФЗ).
// Провал/таймаут/приватный IP → null, ничего не ломаем. Вызывается один раз
// на новую сессию (результат хранится в sessions.geo).

const PRIVATE_RE =
  /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i

export async function lookupGeo(ip: string | null): Promise<string | null> {
  if (process.env.GEO_PROVIDER !== 'ipwhois') return null
  if (!ip || PRIVATE_RE.test(ip)) return null
  try {
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,city,country_code`, {
      signal: AbortSignal.timeout(2500),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { success?: boolean; city?: string; country_code?: string }
    if (!j.success) return null
    const parts = [j.city, j.country_code].filter(Boolean)
    return parts.length ? parts.join(', ').slice(0, 80) : null
  } catch {
    return null
  }
}
