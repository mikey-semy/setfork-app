import 'server-only'

// Гео по IP для «Seen in …» у сессий (как GitHub). Best-effort и без ключа:
// ipwho.is (бесплатный tier). Провал/таймаут/приватный IP → null, ничего не ломаем.
// Вызывается ОДИН раз на новую сессию (результат хранится в sessions.geo), поэтому
// объёмы мизерные и внешний провайдер с ключом (MaxMind/ipinfo) пока не нужен.

const PRIVATE_RE =
  /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i

export async function lookupGeo(ip: string | null): Promise<string | null> {
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
