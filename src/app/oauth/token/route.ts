import { NextResponse } from 'next/server'
import { exchangeCode, pruneExpiredCodes, refreshTokens } from '@/shared/auth/oauth-server'
import { clientIp, rateLimit } from '@/shared/rate-limit'

/**
 * Обмен кода на токен и обновление доступа.
 *
 * ⚠️ ТЕЛО — `application/x-www-form-urlencoded`, А НЕ JSON. Клиент шлёт форму, и парсер,
 * умеющий только JSON, отвечает 415: подключение обрывается на последнем шаге, когда
 * человек уже дал согласие. Это проверенное требование, а не предположение.
 *
 * Ответ всегда без кеша: токен не должен осесть ни в одном промежуточном хранилище.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RATE_PER_MIN = 30

function fail(error: string, status = 400): NextResponse {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request): Promise<NextResponse> {
  // Подбор кода и refresh-токена — единственный способ их угадать, поэтому лимит стоит
  // до разбора тела: отказ должен быть дешевле проверки.
  const limited = await rateLimit(`oauth:token:${clientIp(req)}`, RATE_PER_MIN, 60_000)
  if (!limited.ok) return fail('slow_down', 429)

  const ctype = req.headers.get('content-type') ?? ''
  if (!ctype.includes('application/x-www-form-urlencoded')) return fail('invalid_request', 415)

  const form = new URLSearchParams(await req.text())
  const grant = form.get('grant_type')
  const clientId = form.get('client_id')?.trim() ?? ''
  if (!clientId) return fail('invalid_client', 401)

  await pruneExpiredCodes()

  const result =
    grant === 'authorization_code'
      ? await exchangeCode({
          code: form.get('code')?.trim() ?? '',
          verifier: form.get('code_verifier')?.trim() ?? '',
          redirectUri: form.get('redirect_uri')?.trim() ?? '',
          clientId,
        })
      : grant === 'refresh_token'
        ? await refreshTokens(form.get('refresh_token')?.trim() ?? '', clientId)
        : { error: 'unsupported_grant_type' }

  if ('error' in result) return fail(result.error, result.error === 'invalid_client' ? 401 : 400)

  return NextResponse.json(
    {
      access_token: result.accessToken,
      token_type: 'Bearer',
      expires_in: result.expiresIn,
      refresh_token: result.refreshToken,
      scope: result.scope,
    },
    { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
  )
}
