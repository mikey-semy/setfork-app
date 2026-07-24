// Telegram Bot API. Прямой api.telegram.org с РФ недоступен (SNI-блок ТСПУ) —
// прод ходит через egress-мост под нейтральным SNI: TELEGRAM_API_BASE=
// https://tg-egress.setfork.com (+ extra_hosts в docker-compose.override.yml)
// и TELEGRAM_API_INSECURE=1 (TLS терминится на мосту самоподписанным сертом).
// node:https вместо fetch — undici не даёт выключить проверку серта точечно.
import { createHmac } from 'node:crypto'
import { request } from 'node:https'

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_BOT_USERNAME
}

/** Вызов метода Bot API; ошибки сети/API → null (вход просто не состоится). */
export async function tgApi<T = unknown>(method: string, params: Record<string, unknown>): Promise<T | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return null
  const base = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org'
  const url = new URL(`${base.replace(/\/$/, '')}/bot${token}/${method}`)
  const body = JSON.stringify(params)
  return new Promise((resolve) => {
    const req = request(
      {
        hostname: url.hostname,
        port: url.port ? Number(url.port) : 443,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        rejectUnauthorized: process.env.TELEGRAM_API_INSECURE !== '1',
        timeout: 15_000,
      },
      (res) => {
        let data = ''
        res.on('data', (c: Buffer) => (data += c))
        res.on('end', () => {
          try {
            const j = JSON.parse(data) as { ok?: boolean; result?: T }
            resolve(j.ok ? (j.result as T) : null)
          } catch {
            resolve(null)
          }
        })
      },
    )
    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.write(body)
    req.end()
  })
}

// ── Разбор апдейтов вебхука (чистые функции, юнит-тестируются) ────────

export type TgUser = { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string }
export type TgUpdate = {
  message?: { text?: string; chat?: { id: number }; from?: TgUser }
  callback_query?: {
    id: string
    data?: string
    from?: TgUser
    message?: { chat?: { id: number }; message_id?: number }
  }
}

/** Текст '/start tl_<hex>' → токен входа, иначе null. */
export function parseStartToken(text: string | undefined): string | null {
  const m = /^\/start\s+tl_([a-f0-9]{32,64})$/.exec(text ?? '')
  return m ? m[1] : null
}

/** callback_data 'tglogin:<hex>' → токен входа, иначе null. */
export function parseConfirmToken(data: string | undefined): string | null {
  const m = /^tglogin:([a-f0-9]{32,64})$/.exec(data ?? '')
  return m ? m[1] : null
}

/**
 * 6-значный код подтверждения входа: HMAC(AUTH_SECRET, `token:tgId`) → 6 цифр.
 * Детерминированный (webhook и poll считают одинаково, хранить в БД не нужно) и
 * непредсказуемый без AUTH_SECRET. Привязывает подтверждение к ИНИЦИИРОВАВШЕМУ
 * браузеру: бот шлёт код подтвердившему в Telegram, а завершить вход можно только
 * введя код в браузере с токеном — relay чужой ссылки не даёт сессию (F2, CWE-352).
 */
export function telegramLoginCode(token: string, tgId: number): string {
  const secret = process.env.AUTH_SECRET ?? ''
  const mac = createHmac('sha256', secret).update(`${token}:${tgId}`).digest()
  return String(mac.readUInt32BE(0) % 1_000_000).padStart(6, '0')
}
