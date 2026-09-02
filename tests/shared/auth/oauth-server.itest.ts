import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { resetTables } from '../../helpers/reset-db'

/**
 * ⚠️ ЗАЩИТЫ СЕРВЕРА АВТОРИЗАЦИИ — ТО, ЧТО ОТЛИЧАЕТ ЕГО ОТ РАЗДАЧИ ТОКЕНОВ ВСЕМ ЖЕЛАЮЩИМ.
 *
 * Свой сервер мы пишем вынужденно: официальный SDK версии 2 выбросил серверную часть
 * («MCP-сервер это resource server, он никогда не выпускает токены»), а единственная
 * библиотека под Next.js требует перевести на неё всю аутентификацию приложения.
 * Значит каждая проверка спецификации — наша ответственность, и каждая закрыта тестом.
 */
const { db, users, oauthCodes, apiTokens } = await import('@/shared/db')
const { exchangeCode, issueCode, parseAuthorize, refreshTokens } = await import('@/shared/auth/oauth-server')

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
const RESOURCE = 'https://setfork.com/api/mcp'
let userId = ''

const verifier = randomBytes(32).toString('base64url')
const challenge = createHash('sha256').update(verifier).digest('base64url')

const query = (over: Record<string, string> = {}) =>
  new URLSearchParams({
    response_type: 'code',
    client_id: 'https://claude.ai',
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'write',
    resource: RESOURCE,
    ...over,
  })

beforeAll(async () => {
  await resetTables([users, oauthCodes, apiTokens])
  const [u] = await db.insert(users).values({ handle: 'oauth-user' }).returning({ id: users.id })
  userId = u.id
})

describe('разбор запроса на авторизацию', () => {
  it('чужой адрес возврата отвергается: иначе код уедет на посторонний сайт', () => {
    const r = parseAuthorize(query({ redirect_uri: 'https://evil.example/callback' }))
    expect(r.ok).toBe(false)
  })

  it('локальный адрес разрешён с ЛЮБЫМ портом: терминал берёт случайный', () => {
    expect(parseAuthorize(query({ redirect_uri: 'http://127.0.0.1:54321/cb' })).ok).toBe(true)
    expect(parseAuthorize(query({ redirect_uri: 'http://localhost:9/cb' })).ok).toBe(true)
    // Но не `http` на чужом хосте — это отправка кода открытым текстом.
    expect(parseAuthorize(query({ redirect_uri: 'http://evil.example/cb' })).ok).toBe(false)
  })

  it('без S256 отказ: plain не защищает от перехвата кода', () => {
    expect(parseAuthorize(query({ code_challenge_method: 'plain' })).ok).toBe(false)
  })

  it('чужой resource отвергается: это просьба выдать ключ от другого замка', () => {
    expect(parseAuthorize(query({ resource: 'https://other.example/api/mcp' })).ok).toBe(false)
  })
})

describe('обмен кода на токен', () => {
  const req = () => {
    const p = parseAuthorize(query())
    if (!p.ok) throw new Error('запрос должен разбираться')
    return p.req
  }

  it('верный обмен выдаёт токен и обновление', async () => {
    const code = await issueCode(req(), userId)
    const res = await exchangeCode({ code, verifier, redirectUri: REDIRECT, clientId: 'https://claude.ai' })
    expect('accessToken' in res && res.accessToken.startsWith('sf_')).toBe(true)
    expect('refreshToken' in res).toBe(true)
  })

  it('неверный verifier не проходит — в этом и смысл PKCE', async () => {
    const code = await issueCode(req(), userId)
    const res = await exchangeCode({ code, verifier: 'wrong', redirectUri: REDIRECT, clientId: 'https://claude.ai' })
    expect(res).toEqual({ error: 'invalid_grant' })
  })

  it('код одноразовый: второй обмен обязан отказать', async () => {
    const code = await issueCode(req(), userId)
    await exchangeCode({ code, verifier, redirectUri: REDIRECT, clientId: 'https://claude.ai' })
    const again = await exchangeCode({ code, verifier, redirectUri: REDIRECT, clientId: 'https://claude.ai' })
    expect(again).toEqual({ error: 'invalid_grant' })
  })

  it('адрес возврата сверяется побайтово', async () => {
    const code = await issueCode(req(), userId)
    const res = await exchangeCode({
      code,
      verifier,
      redirectUri: `${REDIRECT}/`,
      clientId: 'https://claude.ai',
    })
    expect(res).toEqual({ error: 'invalid_grant' })
  })

  it('просроченный код не обменивается', async () => {
    const code = await issueCode(req(), userId)
    await db
      .update(oauthCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthCodes.codeHash, createHash('sha256').update(code).digest('hex')))
    const res = await exchangeCode({ code, verifier, redirectUri: REDIRECT, clientId: 'https://claude.ai' })
    expect(res).toEqual({ error: 'invalid_grant' })
  })
})

describe('обновление доступа', () => {
  it('ротация: прежнее обновление гаснет, повторное использование отвергается', async () => {
    const p = parseAuthorize(query())
    if (!p.ok) throw new Error('запрос должен разбираться')
    const code = await issueCode(p.req, userId)
    const first = await exchangeCode({ code, verifier, redirectUri: REDIRECT, clientId: 'https://claude.ai' })
    if (!('refreshToken' in first)) throw new Error('ожидался токен')

    const second = await refreshTokens(first.refreshToken, 'https://claude.ai')
    expect('refreshToken' in second && second.refreshToken !== first.refreshToken).toBe(true)

    const replay = await refreshTokens(first.refreshToken, 'https://claude.ai')
    expect(replay, 'украденный и уже использованный токен обязан отказать').toEqual({ error: 'invalid_grant' })
  })
})
