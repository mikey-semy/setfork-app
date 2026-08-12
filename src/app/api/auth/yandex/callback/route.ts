// Callback Яндекс OAuth: state → токен → login.yandex.ru/info → сессия.
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { upsertOauthUser } from '@/shared/auth/users'
import { finishOauthLogin } from '@/features/auth/oauth-finish'
import { appOrigin } from '@/shared/auth/app-origin'

export async function GET(req: NextRequest) {
  const appUrl = appOrigin()
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  const c = await cookies()
  const savedState = c.get('ya_oauth_state')?.value
  c.delete('ya_oauth_state')

  if (!code || !state || state !== savedState) {
    return NextResponse.redirect(`${appUrl}/login?e=oauth_state`)
  }

  const tokenRes = await fetch('https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.YANDEX_CLIENT_ID ?? '',
      client_secret: process.env.YANDEX_CLIENT_SECRET ?? '',
    }),
  })
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as { access_token?: string }
  if (!tokenJson.access_token) {
    return NextResponse.redirect(`${appUrl}/login?e=oauth_token`)
  }

  const infoRes = await fetch('https://login.yandex.ru/info?format=json', {
    headers: { Authorization: `OAuth ${tokenJson.access_token}` },
  })
  const ya = (await infoRes.json().catch(() => ({}))) as {
    id?: string
    login?: string
    display_name?: string | null
    real_name?: string | null
    default_email?: string | null
    default_avatar_id?: string | null
    is_avatar_empty?: boolean
  }
  if (!ya.id) {
    return NextResponse.redirect(`${appUrl}/login?e=oauth_user`)
  }

  const session = await upsertOauthUser('yandex', {
    externalId: ya.id,
    handleCandidates: [ya.login, ya.default_email?.split('@')[0], ya.display_name, ya.real_name],
    name: ya.real_name || ya.display_name || ya.login || null,
    avatarUrl:
      ya.default_avatar_id && !ya.is_avatar_empty
        ? `https://avatars.yandex.net/get-yapic/${ya.default_avatar_id}/islands-200`
        : null,
    email: ya.default_email,
  })
  return NextResponse.redirect(await finishOauthLogin(session, appUrl))
}
