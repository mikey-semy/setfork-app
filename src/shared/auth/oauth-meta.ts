import { SITE_ORIGIN } from '@/shared/site'

/**
 * ЕДИНЫЕ АДРЕСА И ПОЛЯ МЕТАДАННЫХ OAUTH.
 *
 * ⚠️ `RESOURCE` ОБЯЗАН ПОБАЙТОВО СОВПАДАТЬ С ТЕМ, ЧТО ЧЕЛОВЕК ВВОДИТ В ФОРМЕ
 * ПОДКЛЮЧЕНИЯ. Клиент сверяет строку целиком: лишний слэш в конце или другой регистр —
 * и подключение отваливается с невнятной ошибкой. У нас это `https://setfork.com/api/mcp`.
 *
 * ⚠️ ПЕРВЫЙ АДРЕС В `authorization_servers` — ЕДИНСТВЕННЫЙ, который пробует клиент.
 * Второй элемент списка он не запрашивает, поэтому запасного варианта там быть не может.
 */
export const MCP_RESOURCE = `${SITE_ORIGIN}/api/mcp`

/** Наш сервер авторизации — тот же origin: отдельного домена у нас нет. */
export const AUTH_ISSUER = SITE_ORIGIN

/**
 * Единственный разрешённый адрес возврата. Он один и для веба, и для приложения, и для
 * телефона — поэтому список закрытый, а не «что пришло, то и подставим»: открытый
 * редирект в OAuth это способ увести код авторизации на чужой сайт.
 */
export const ALLOWED_REDIRECTS = ['https://claude.ai/api/mcp/auth_callback'] as const

/**
 * ⚠️ ЛОКАЛЬНЫЙ АДРЕС — ОТДЕЛЬНОЕ ПРАВИЛО, И ПОРТ В НЁМ НЕ СРАВНИВАЕТСЯ. Терминальный
 * клиент поднимает слушателя на СЛУЧАЙНОМ свободном порту, поэтому точное сравнение
 * отвергало бы каждое второе подключение. Схема при этом обязана быть `http` именно на
 * петле: `http` на чужом хосте — это отправка кода авторизации открытым текстом.
 */
function isLoopback(uri: string): boolean {
  try {
    const u = new URL(uri)
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]')
  } catch {
    return false
  }
}

export function isAllowedRedirect(uri: string): boolean {
  return (ALLOWED_REDIRECTS as readonly string[]).includes(uri) || isLoopback(uri)
}

/** Права, которые мы умеем выдавать: те же, что у статических токенов. */
export const OAUTH_SCOPES = ['read', 'write'] as const
export type OAuthScope = (typeof OAUTH_SCOPES)[number]

export function normalizeScope(raw: string | null | undefined): OAuthScope {
  // `write` включает чтение — как у статических токенов, где scope одно поле.
  return raw?.split(/\s+/).includes('write') ? 'write' : 'read'
}
