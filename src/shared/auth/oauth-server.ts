import 'server-only'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq, isNull, lt } from 'drizzle-orm'
import { apiTokens, db, oauthCodes, oauthRefreshTokens } from '@/shared/db'
import { MCP_RESOURCE, isAllowedRedirect, normalizeScope, type OAuthScope } from './oauth-meta'

/**
 * СЕРВЕР АВТОРИЗАЦИИ ДЛЯ MCP — СВОЙ, И ЭТО НЕ САМОДЕЯТЕЛЬНОСТЬ.
 *
 * Официальный SDK версии 2 (27.07.2026) выбросил серверную часть: в документации прямо
 * сказано, что MCP-сервер — это resource server, он проверяет токены и НИКОГДА их не
 * выпускает. Единственная библиотека с сервером авторизации внутри Next.js требует
 * перевести всю аутентификацию приложения на неё, а у нас своя сессия, WebAuthn и TOTP.
 * Поэтому — минимальный сервер по официальному примеру Anthropic: `/authorize`,
 * `/token` и два документа well-known.
 *
 * ⚠️ ДИНАМИЧЕСКОЙ РЕГИСТРАЦИИ (DCR) ЗДЕСЬ НЕТ НАМЕРЕННО. Спецификация от 28.07.2026
 * объявила её устаревшей в пользу Client ID Metadata Documents, и у неё есть
 * практический порок: клиент регистрируется заново на КАЖДОЕ подключение.
 */

const CODE_TTL_MS = 10 * 60 * 1000 // код живёт минуты: он одноразовый и обменивается сразу
const ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000
const REFRESH_TTL_MS = 180 * 24 * 60 * 60 * 1000

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex')
const newSecret = (): string => randomBytes(32).toString('base64url')

/** Сверка PKCE: `S256` от проверочного слова обязана совпасть с сохранённым вызовом. */
function pkceMatches(verifier: string, challenge: string): boolean {
  const actual = createHash('sha256').update(verifier).digest('base64url')
  const a = Buffer.from(actual)
  const b = Buffer.from(challenge)
  // Сравнение постоянного времени: длину проверяем отдельно, иначе timingSafeEqual бросит.
  return a.length === b.length && timingSafeEqual(a, b)
}

export type AuthorizeRequest = {
  clientId: string
  redirectUri: string
  codeChallenge: string
  scope: OAuthScope
  state: string | null
  resource: string
}

/** Разбор и проверка запроса на авторизацию. Ошибку возвращаем текстом, а не бросаем. */
export function parseAuthorize(params: URLSearchParams): { ok: true; req: AuthorizeRequest } | { ok: false; error: string } {
  const clientId = params.get('client_id')?.trim() ?? ''
  const redirectUri = params.get('redirect_uri')?.trim() ?? ''
  const codeChallenge = params.get('code_challenge')?.trim() ?? ''
  const method = params.get('code_challenge_method')?.trim() ?? ''
  const resource = params.get('resource')?.trim() || MCP_RESOURCE

  if (params.get('response_type') !== 'code') return { ok: false, error: 'unsupported_response_type' }
  if (!clientId) return { ok: false, error: 'invalid_request' }
  // ⚠️ Открытый редирект в OAuth уводит код авторизации на чужой сайт — список закрыт.
  if (!isAllowedRedirect(redirectUri)) return { ok: false, error: 'invalid_redirect_uri' }
  // `plain` не принимаем: он не защищает от перехвата кода, ради чего PKCE и заведён.
  if (method !== 'S256' || !codeChallenge) return { ok: false, error: 'invalid_request' }
  // Токен выдаётся ДЛЯ НАШЕГО ресурса: чужой `resource` — это просьба выдать ключ от
  // другого замка (RFC 8707).
  if (resource !== MCP_RESOURCE) return { ok: false, error: 'invalid_target' }

  return {
    ok: true,
    req: {
      clientId,
      redirectUri,
      codeChallenge,
      scope: normalizeScope(params.get('scope')),
      state: params.get('state'),
      resource,
    },
  }
}

/** Создать одноразовый код после согласия человека. Возвращает сам код (его не храним). */
export async function issueCode(req: AuthorizeRequest, userId: string): Promise<string> {
  const code = newSecret()
  await db.insert(oauthCodes).values({
    codeHash: sha256(code),
    userId,
    clientId: req.clientId,
    redirectUri: req.redirectUri,
    codeChallenge: req.codeChallenge,
    scope: req.scope,
    audience: req.resource,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  })
  return code
}

export type TokenPair = { accessToken: string; refreshToken: string; scope: OAuthScope; expiresIn: number }

async function issueTokens(userId: string, clientId: string, scope: OAuthScope): Promise<TokenPair> {
  // Доступный токен кладём в ту же таблицу, что и статические: проверка остаётся одна
  // на оба способа, и ключ, вбитый руками, продолжает работать (так же у Sentry).
  const accessToken = `sf_${newSecret()}`
  const expiresAt = new Date(Date.now() + ACCESS_TTL_MS)
  const [row] = await db
    .insert(apiTokens)
    .values({
      userId,
      name: `MCP · ${clientId}`.slice(0, 80),
      tokenHash: sha256(accessToken),
      prefix: accessToken.slice(0, 9),
      scope,
      expiresAt,
    })
    .returning({ id: apiTokens.id })

  const refreshToken = newSecret()
  await db.insert(oauthRefreshTokens).values({
    tokenHash: sha256(refreshToken),
    userId,
    accessTokenId: row.id,
    clientId,
    scope,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  })

  return { accessToken, refreshToken, scope, expiresIn: Math.floor(ACCESS_TTL_MS / 1000) }
}

/** Обмен кода на токен: одноразовость, срок, PKCE и точный адрес возврата. */
export async function exchangeCode(input: {
  code: string
  verifier: string
  redirectUri: string
  clientId: string
}): Promise<TokenPair | { error: string }> {
  const [row] = await db.select().from(oauthCodes).where(eq(oauthCodes.codeHash, sha256(input.code))).limit(1)
  if (!row) return { error: 'invalid_grant' }
  // Повторный обмен обязан отказать, а не выдать второй токен: перехваченный код
  // иначе работает столько раз, сколько его успеют предъявить.
  if (row.usedAt || row.expiresAt.getTime() < Date.now()) return { error: 'invalid_grant' }
  if (row.redirectUri !== input.redirectUri || row.clientId !== input.clientId) return { error: 'invalid_grant' }
  if (!pkceMatches(input.verifier, row.codeChallenge)) return { error: 'invalid_grant' }
  if (row.audience !== MCP_RESOURCE) return { error: 'invalid_target' }

  await db.update(oauthCodes).set({ usedAt: new Date() }).where(eq(oauthCodes.id, row.id))
  return issueTokens(row.userId, row.clientId, row.scope === 'write' ? 'write' : 'read')
}

/**
 * Обновление доступа С РОТАЦИЕЙ: прежний refresh гасится, вместе с ним — выданный по
 * нему токен. Украденный и уже использованный чужим клиентом токен обнаружится на
 * первом же обмене законного (рекомендация OAuth 2.1 для публичных клиентов).
 */
export async function refreshTokens(refreshToken: string, clientId: string): Promise<TokenPair | { error: string }> {
  const [row] = await db
    .select()
    .from(oauthRefreshTokens)
    .where(and(eq(oauthRefreshTokens.tokenHash, sha256(refreshToken)), isNull(oauthRefreshTokens.revokedAt)))
    .limit(1)
  if (!row || row.expiresAt.getTime() < Date.now() || row.clientId !== clientId) return { error: 'invalid_grant' }

  await db.update(oauthRefreshTokens).set({ revokedAt: new Date() }).where(eq(oauthRefreshTokens.id, row.id))
  if (row.accessTokenId) await db.delete(apiTokens).where(eq(apiTokens.id, row.accessTokenId))

  return issueTokens(row.userId, row.clientId, row.scope === 'write' ? 'write' : 'read')
}

/** Уборка просроченных кодов — вызывается перед выдачей, чтобы таблица не росла. */
export async function pruneExpiredCodes(): Promise<void> {
  await db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, new Date(Date.now() - CODE_TTL_MS)))
}
