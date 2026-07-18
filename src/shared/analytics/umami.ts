import 'server-only'

/**
 * Клиент к Umami для «онлайн всех, включая анонимов». БД видит присутствие только вошедших
 * (sessions.lastSeenAt); анонимов в реалтайме не видит (просмотры дедуплятся по суткам). Umami же
 * трекает КАЖДЫЙ визит и умеет «active visitors» из коробки — берём оттуда.
 *
 * Всё best-effort по образцу getOpenRouterCredits: не настроено или сбой → null, дашборд молча
 * показывает только вошедших. Никогда не роняет вызывающего.
 *
 * Настройка (env на проде): UMAMI_API_URL (или NEXT_PUBLIC_UMAMI_URL), UMAMI_WEBSITE_ID (или
 * NEXT_PUBLIC_UMAMI_WEBSITE_ID) и авторизация — либо UMAMI_API_KEY, либо UMAMI_USERNAME+PASSWORD.
 */

function cfg() {
  const base = (process.env.UMAMI_API_URL || process.env.NEXT_PUBLIC_UMAMI_URL || '').replace(/\/+$/, '')
  const website = process.env.UMAMI_WEBSITE_ID || process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID || ''
  return {
    base,
    website,
    apiKey: process.env.UMAMI_API_KEY || '',
    user: process.env.UMAMI_USERNAME || '',
    pass: process.env.UMAMI_PASSWORD || '',
  }
}

/** Достаточно ли конфигурации, чтобы вообще пытаться. Дашборд показывает подсказку, если нет. */
export function umamiConfigured(): boolean {
  const c = cfg()
  return Boolean(c.base && c.website && (c.apiKey || (c.user && c.pass)))
}

let activeCache: { active: number; at: number } | null = null
let tokenCache: { token: string; at: number } | null = null
const ACTIVE_TTL_MS = 15_000
const TOKEN_TTL_MS = 30 * 60_000

async function authHeaders(): Promise<Record<string, string> | null> {
  const c = cfg()
  if (c.apiKey) return { 'x-umami-api-key': c.apiKey }
  if (!(c.user && c.pass)) return null
  if (tokenCache && Date.now() - tokenCache.at < TOKEN_TTL_MS) return { Authorization: `Bearer ${tokenCache.token}` }
  try {
    const res = await fetch(`${c.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: c.user, password: c.pass }),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.warn(`[umami] login HTTP ${res.status}`)
      return null
    }
    const j = (await res.json()) as { token?: string }
    if (!j.token) return null
    tokenCache = { token: j.token, at: Date.now() }
    return { Authorization: `Bearer ${j.token}` }
  } catch (e) {
    console.warn('[umami] login error', e instanceof Error ? e.message : e)
    return null
  }
}

/** Активные посетители (~5 мин, вкл. анонимов). null — не настроено или сбой (тогда дашборд падает
 *  на «только вошедшие»). Нормализуем разные формы ответа между версиями Umami. */
export async function getUmamiActive(): Promise<number | null> {
  if (!umamiConfigured()) return null
  if (activeCache && Date.now() - activeCache.at < ACTIVE_TTL_MS) return activeCache.active
  const c = cfg()
  const headers = await authHeaders()
  if (!headers) return activeCache?.active ?? null
  try {
    const res = await fetch(`${c.base}/api/websites/${c.website}/active`, { headers, cache: 'no-store' })
    if (res.status === 401) tokenCache = null // токен протух — сбросим, на следующем тике перелогинимся
    if (!res.ok) {
      console.warn(`[umami] active HTTP ${res.status}`)
      return activeCache?.active ?? null
    }
    const j = (await res.json()) as unknown
    // v2 → [{ x: N }]; новее → { visitors: N } или { x: N }.
    const active = Array.isArray(j)
      ? j.reduce((s: number, r) => s + (Number((r as { x?: number })?.x) || 0), 0)
      : Number((j as { visitors?: number }).visitors ?? (j as { x?: number }).x) || 0
    activeCache = { active, at: Date.now() }
    return active
  } catch (e) {
    console.warn('[umami] active error', e instanceof Error ? e.message : e)
    return activeCache?.active ?? null
  }
}
