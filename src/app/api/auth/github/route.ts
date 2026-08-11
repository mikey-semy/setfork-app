// Старт GitHub OAuth: редирект на authorize с anti-CSRF state.
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { oauthEnabled } from '@/shared/auth/oauth'
import { appOrigin } from '@/shared/auth/app-origin'

export async function GET() {
  const clientId = process.env.GITHUB_CLIENT_ID
  const appUrl = appOrigin()
  if (!clientId || !oauthEnabled().github) {
    // Провайдер не настроен или выключен → на /login, где остальные способы входа.
    return NextResponse.redirect(`${appUrl}/login?e=oauth_off`)
  }

  const state = crypto.randomUUID()
  const c = await cookies()
  c.set('gh_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  })

  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', `${appUrl}/api/auth/github/callback`)
  url.searchParams.set('scope', 'read:user')
  url.searchParams.set('state', state)
  return NextResponse.redirect(url.toString())
}
