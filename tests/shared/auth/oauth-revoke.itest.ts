import { createHash, randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { resetTables } from '../../helpers/reset-db'

/**
 * RFC 7009 — ОТЗЫВ ТОКЕНА (ревью соответствия 23.09, PR 2 п. 3).
 *
 * Грант получается настоящим путём: разбор запроса → код → обмен. Проверяем, что после
 * отзыва не работает НИ ОДНА половина гранта, что чужой клиент отозвать не может, что
 * токен из настроек этот эндпоинт не трогает и что незнакомый токен — «успех» (§2.2).
 */
const h = vi.hoisted(() => ({ userId: '', limited: false }))
// Экшен настроек: сессия — владелец токенов; сброс кэша страниц — не предмет теста.
vi.mock('@/shared/auth/session', () => ({ requireSession: async () => ({ userId: h.userId, handle: 'revoke-user' }), getSession: async () => ({ userId: h.userId, handle: 'revoke-user' }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/shared/rate-limit', async (orig) => ({
  ...(await orig()),
  rateLimit: async () => (h.limited ? { ok: false, retryAfter: 17 } : { ok: true, remaining: 1, retryAfter: 0 }),
}))

const { db, users, oauthCodes, oauthRefreshTokens, apiTokens, auditLog } = await import('@/shared/db')
const { revokeApiToken } = await import('@/features/mcp/actions')
const { exchangeCode, issueCode, parseAuthorize, refreshTokens } = await import('@/shared/auth/oauth-server')
const { verifyApiToken } = await import('@/shared/auth/api-token')
const { POST: revoke } = await import('@/app/oauth/revoke/route')
const { GET: metadata } = await import('@/app/.well-known/oauth-authorization-server/route')

const CLIENT = 'https://claude.ai'
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
let userId = ''

async function grant(clientId = CLIENT, forUser = () => userId) {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const parsed = parseAuthorize(
    new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', scope: 'write', resource: 'https://setfork.com/api/mcp' }),
  )
  if (!parsed.ok) throw new Error(parsed.error)
  const code = await issueCode(parsed.req, forUser())
  const pair = await exchangeCode({ code, verifier, redirectUri: REDIRECT, clientId })
  if ('error' in pair) throw new Error(pair.error)
  return pair
}

const post = (fields: Record<string, string>, contentType = 'application/x-www-form-urlencoded') =>
  revoke(new Request('https://setfork.test/oauth/revoke', { method: 'POST', headers: { 'content-type': contentType }, body: new URLSearchParams(fields).toString() }))

const alive = async (pair: { accessToken: string; refreshToken: string }) => {
  expect(await verifyApiToken(pair.accessToken), 'токен доступа погашен').not.toBeNull()
  const [row] = await db.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.tokenHash, createHash('sha256').update(pair.refreshToken).digest('hex')))
  expect(row?.revokedAt, 'refresh погашен').toBeNull()
}

async function dead(pair: { accessToken: string; refreshToken: string }) {
  expect(await verifyApiToken(pair.accessToken), 'токен доступа жив').toBeNull()
  expect(await refreshTokens(pair.refreshToken, CLIENT), 'refresh жив').toEqual({ error: 'invalid_grant' })
}

beforeEach(async () => {
  await resetTables([auditLog, oauthRefreshTokens, apiTokens, oauthCodes, users])
  const [u] = await db.insert(users).values({ handle: 'revoke-user' }).returning({ id: users.id })
  userId = u.id
  h.userId = u.id
  h.limited = false
})

describe('отзыв гасит весь грант', () => {
  it('по refresh-токену — мёртвы обе половины', async () => {
    const pair = await grant()
    expect(await verifyApiToken(pair.accessToken)).not.toBeNull()
    const res = await post({ token: pair.refreshToken, token_type_hint: 'refresh_token', client_id: CLIENT })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    await dead(pair)
  })

  it('по токену доступа — тоже обе', async () => {
    const pair = await grant()
    expect((await post({ token: pair.accessToken, token_type_hint: 'access_token', client_id: CLIENT })).status).toBe(200)
    await dead(pair)
  })

  it('неверная подсказка — ищем среди остальных видов (§2.1)', async () => {
    const pair = await grant()
    expect((await post({ token: pair.accessToken, token_type_hint: 'refresh_token', client_id: CLIENT })).status).toBe(200)
    await dead(pair)
  })

  it('без подсказки — тоже находится', async () => {
    const pair = await grant()
    expect((await post({ token: pair.accessToken, client_id: CLIENT })).status).toBe(200)
    await dead(pair)
  })
})

describe('грант — вся цепочка ротаций', () => {
  it('отзыв УСТАРЕВШЕГО refresh (ответ на обновление потерян) гасит новую пару', async () => {
    const first = await grant()
    const second = await refreshTokens(first.refreshToken, CLIENT)
    if ('error' in second) throw new Error(second.error)
    expect((await post({ token: first.refreshToken, client_id: CLIENT })).status).toBe(200)
    await dead(second)
  })

  it('соседи уцелели: другой грант того же человека, токен из настроек, грант другого человека', async () => {
    const target = await grant()
    const sameUser = await grant()
    const manual = `sf_${randomBytes(32).toString('base64url')}`
    await db.insert(apiTokens).values({ userId, name: 'manual', tokenHash: createHash('sha256').update(manual).digest('hex'), prefix: manual.slice(0, 9), scope: 'write' })
    const [other] = await db.insert(users).values({ handle: 'other-user' }).returning({ id: users.id })
    const otherUser = await grant(CLIENT, () => other.id)
    await post({ token: target.refreshToken, client_id: CLIENT })
    await dead(target)
    await alive(sameUser)
    await alive(otherUser)
    expect(await verifyApiToken(manual)).not.toBeNull()
  })

  it('отзыв пишется в журнал аудита — как отзыв из настроек', async () => {
    const pair = await grant()
    await post({ token: pair.refreshToken, client_id: CLIENT })
    const [row] = await db.select().from(auditLog).where(eq(auditLog.action, 'token.revoke'))
    expect(row).toMatchObject({ actorId: userId })
    expect(row.meta).toMatchObject({ via: 'oauth', clientId: CLIENT })
  })
})

describe('отзыв из настроек', () => {
  it('OAuth-токен доступа, удалённый в настройках, не возвращается через refresh', async () => {
    const pair = await grant()
    const [row] = await db.select({ id: apiTokens.id }).from(apiTokens).where(eq(apiTokens.tokenHash, createHash('sha256').update(pair.accessToken).digest('hex')))
    await revokeApiToken(row.id)
    await dead(pair)
  })
})

describe('кто и что может отозвать', () => {
  it('чужой клиент — отказ unauthorized_client, грант жив', async () => {
    const pair = await grant()
    const res = await post({ token: pair.refreshToken, client_id: 'https://other.example' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'unauthorized_client' })
    await alive(pair)
  })

  it('чужой клиент с токеном доступа — тоже отказ, грант жив', async () => {
    const pair = await grant()
    expect((await post({ token: pair.accessToken, client_id: 'https://other.example' })).status).toBe(400)
    await alive(pair)
  })

  it('чужой клиент на уже погашенный грант — 200 (§2.2: недействительный токен)', async () => {
    const pair = await grant()
    await post({ token: pair.refreshToken, client_id: CLIENT })
    expect((await post({ token: pair.refreshToken, client_id: 'https://other.example' })).status).toBe(200)
  })

  it('refresh с подсказкой access_token — находится (§2.1)', async () => {
    const pair = await grant()
    expect((await post({ token: pair.refreshToken, token_type_hint: 'access_token', client_id: CLIENT })).status).toBe(200)
    await dead(pair)
  })

  it('токен из настроек (не выдан клиенту OAuth) — 200, но жив', async () => {
    const token = `sf_${randomBytes(32).toString('base64url')}`
    await db.insert(apiTokens).values({ userId, name: 'manual', tokenHash: createHash('sha256').update(token).digest('hex'), prefix: token.slice(0, 9), scope: 'write' })
    expect((await post({ token, client_id: CLIENT })).status).toBe(200)
    expect(await verifyApiToken(token)).not.toBeNull()
  })

  it('незнакомый и уже отозванный токен — 200 (§2.2): перебором живые не найти', async () => {
    expect((await post({ token: 'not-a-token', client_id: CLIENT })).status).toBe(200)
    const pair = await grant()
    await post({ token: pair.refreshToken, client_id: CLIENT })
    expect((await post({ token: pair.refreshToken, client_id: CLIENT })).status).toBe(200)
  })
})

describe('форма запроса', () => {
  it('без токена — 400 invalid_request, без client_id — 401 invalid_client, не форма — 415', async () => {
    const noToken = await post({ client_id: CLIENT })
    expect(noToken.status).toBe(400)
    expect(await noToken.json()).toEqual({ error: 'invalid_request' })
    const noClient = await post({ token: 'x' })
    expect(noClient.status).toBe(401)
    expect(await noClient.json()).toEqual({ error: 'invalid_client' })
    expect((await post({ token: 'x', client_id: CLIENT }, 'application/json')).status).toBe(415)
  })
})

describe('лимит частоты', () => {
  it('429 slow_down с Retry-After', async () => {
    h.limited = true
    const res = await post({ token: 'x', client_id: CLIENT })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('17')
    expect(await res.json()).toEqual({ error: 'slow_down' })
  })
})

describe('метаданные сервера (RFC 8414)', () => {
  it('объявляют revocation_endpoint и способ подтверждения клиента', async () => {
    const meta = await (await metadata()).json()
    expect(meta.revocation_endpoint).toBe(`${meta.issuer}/oauth/revoke`)
    expect(meta.revocation_endpoint_auth_methods_supported).toEqual(['none'])
  })
})
