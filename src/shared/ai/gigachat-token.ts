import 'server-only'
import { randomUUID } from 'crypto'

// OAuth GigaChat: access_token живёт ~30 минут — кешируем и обновляем заранее.
// Авторизация обменом Basic-ключа (ClientID:Secret в base64) на Bearer.
// ⚠️ TLS: у Сбера сертификат НУЦ Минцифры — процессу нужен
// NODE_EXTRA_CA_CERTS=certs/russian-trusted-ca-bundle.pem (см. Dockerfile/.env.example),
// иначе fetch упадёт на проверке цепочки.

const OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth'
const REFRESH_EARLY_MS = 60_000 // обновляем за минуту до истечения

let cache: { token: string; expiresAt: number; authKey: string } | null = null

/** Bearer-токен GigaChat (кеш до истечения). null — не сконфигурирован/ошибка. */
export async function getGigaChatToken(authKey: string, scope: string): Promise<string | null> {
  if (!authKey) return null
  // Смена ключа в админке инвалидирует кеш (сравниваем, чей токен лежит).
  if (cache && cache.authKey === authKey && Date.now() < cache.expiresAt - REFRESH_EARLY_MS) return cache.token
  try {
    const res = await fetch(process.env.GIGACHAT_OAUTH_URL || OAUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        RqUID: randomUUID(),
        Authorization: `Basic ${authKey}`,
      },
      body: new URLSearchParams({ scope }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      console.warn(`[gigachat] oauth HTTP ${res.status}`)
      return cache?.token ?? null // старый токен мог ещё жить — лучше, чем ничего
    }
    const j = (await res.json()) as { access_token?: string; expires_at?: number }
    if (!j.access_token) return null
    // expires_at приходит в unix МИЛЛИСЕКУНДАХ; на случай секунд — эвристика.
    const expiresAt = j.expires_at
      ? j.expires_at > 1e12
        ? j.expires_at
        : j.expires_at * 1000
      : Date.now() + 25 * 60_000
    cache = { token: j.access_token, expiresAt, authKey }
    return j.access_token
  } catch (e) {
    console.warn('[gigachat] oauth failed', e instanceof Error ? e.message : e)
    return cache?.token ?? null
  }
}

export function clearGigaChatTokenCache(): void {
  cache = null
}
