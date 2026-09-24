import { NextResponse } from 'next/server'
import { revokeToken } from '@/shared/auth/oauth-server'
import { clientIp, rateLimit } from '@/shared/rate-limit'

/**
 * RFC 7009 — отзыв токена. Клиент при выходе сообщает, что токен больше не нужен.
 *
 * Тело — `application/x-www-form-urlencoded`, как у `/oauth/token` (§2.1). Клиент
 * публичный (`token_endpoint_auth_method: none`), поэтому личность клиента — `client_id`:
 * отзывается только выданное ему (см. `revokeToken`).
 *
 * Ответ на успех — 200 без тела, и на незнакомый токен тоже (§2.2): иначе по ответу можно
 * было бы перебирать живые токены. Ошибки — в формате OAuth (`{"error": …}`, RFC 6749
 * §5.2), без кеша.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Тот же бюджет, что у `/oauth/token`: подбор здесь — такой же способ угадать токен. */
const RATE_PER_MIN = 30

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: NO_STORE })

export async function POST(req: Request): Promise<NextResponse> {
  const limited = await rateLimit(`oauth:revoke:${clientIp(req)}`, RATE_PER_MIN, 60_000)
  if (!limited.ok) return fail('slow_down', 429)

  if (!(req.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')) return fail('invalid_request', 415)
  const form = new URLSearchParams(await req.text())
  const clientId = form.get('client_id')?.trim() ?? ''
  if (!clientId) return fail('invalid_client', 401)
  const token = form.get('token')?.trim() ?? ''
  if (!token) return fail('invalid_request')

  const result = await revokeToken(token, clientId, form.get('token_type_hint'))
  if ('error' in result) return fail(result.error)
  return new NextResponse(null, { status: 200, headers: NO_STORE })
}
