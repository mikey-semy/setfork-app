// Старт Яндекс OAuth: редирект на authorize с anti-CSRF state.
// Приложение: oauth.yandex.ru → «Создать приложение», redirect_uri = {APP_URL}/api/auth/yandex/callback.
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { oauthEnabled } from '@/shared/auth/oauth'
import { appOrigin } from '@/shared/auth/app-origin'

export async function GET() {
  const appUrl = appOrigin()
  if (!oauthEnabled().yandex) {
    return NextResponse.redirect(`${appUrl}/login?e=oauth_off`)
  }

  const state = crypto.randomUUID()
  const c = await cookies()
  c.set('ya_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  })

  const url = new URL('https://oauth.yandex.ru/authorize')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', process.env.YANDEX_CLIENT_ID!)
  url.searchParams.set('redirect_uri', `${appUrl}/api/auth/yandex/callback`)
  url.searchParams.set('state', state)
  return NextResponse.redirect(url.toString())
}
