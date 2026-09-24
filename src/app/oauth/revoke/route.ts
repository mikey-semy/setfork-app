import { NextResponse } from 'next/server'
import { revokeToken } from '@/shared/auth/oauth-server'
import { clientIp, rateLimit } from '@/shared/rate-limit'
import { OAUTH_RATE_PER_MIN } from '@/shared/auth/oauth-meta'
import { recordAudit } from '@/shared/audit'

/**
 * RFC 7009 — отзыв токена. Клиент при выходе сообщает, что токен больше не нужен.
 *
 * Тело — `application/x-www-form-urlencoded`, как у `/oauth/token` (§2.1). Клиент
 * публичный (`token_endpoint_auth_method: none`), поэтому личность клиента — `client_id`:
 * отзывается только выданное ему (см. `revokeToken`).
 *
 * Ответ на успех — 200 без тела, и на незнакомый токен тоже (§2.2): иначе по ответу можно
 * было бы перебирать живые токены. Ошибки — телом `{"error": …}` по образцу RFC 6749 §5.2,
 * без кеша; лимит отвечает 429 с `Retry-After` и кодом `slow_down` (из RFC 8628, как у
 * `/oauth/token`). Отзыв пишется в журнал аудита — как отзыв из настроек.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }
const fail = (error: string, status = 400, headers: Record<string, string> = {}) => NextResponse.json({ error }, { status, headers: { ...headers, ...NO_STORE } })

export async function POST(req: Request): Promise<NextResponse> {
  const limited = await rateLimit(`oauth:revoke:${clientIp(req)}`, OAUTH_RATE_PER_MIN, 60_000)
  if (!limited.ok) return fail('slow_down', 429, { 'Retry-After': String(limited.retryAfter) })

  if (!(req.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')) return fail('invalid_request', 415)
  const form = new URLSearchParams(await req.text())
  const clientId = form.get('client_id')?.trim() ?? ''
  if (!clientId) return fail('invalid_client', 401)
  const token = form.get('token')?.trim() ?? ''
  if (!token) return fail('invalid_request')

  const result = await revokeToken(token, clientId, form.get('token_type_hint'))
  if ('error' in result) return fail(result.error)
  if (result.revoked) {
    await recordAudit('token.revoke', { actorId: result.revoked.userId, targetType: 'token', meta: { via: 'oauth', clientId: result.revoked.clientId } })
  }
  return new NextResponse(null, { status: 200, headers: NO_STORE })
}
