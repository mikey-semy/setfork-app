// Старт VK ID (OAuth 2.1 + PKCE, client_secret не нужен): state + code_verifier
// в куках, редирект на id.vk.com/authorize. Приложение: id.vk.com → кабинет
// разработчика, redirect_uri = {APP_URL}/api/auth/vk/callback.
import { createHash, randomBytes } from 'crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { oauthEnabled } from '@/shared/auth/oauth'
import { appOrigin } from '@/shared/auth/app-origin'

export async function GET() {
  const appUrl = appOrigin()
  if (!oauthEnabled().vk) {
    return NextResponse.redirect(`${appUrl}/login?e=oauth_off`)
  }

  const state = crypto.randomUUID()
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')

  const c = await cookies()
  const cookieOpts = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  } as const
  c.set('vk_oauth_state', state, cookieOpts)
  c.set('vk_code_verifier', verifier, cookieOpts)

  const url = new URL('https://id.vk.com/authorize')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', process.env.VK_CLIENT_ID!)
  url.searchParams.set('redirect_uri', `${appUrl}/api/auth/vk/callback`)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  // Скоупы: по умолчанию email (даёт базовый профиль + почту); VK_SCOPE= (пусто) — только профиль.
  const scope = process.env.VK_SCOPE ?? 'email'
  if (scope) url.searchParams.set('scope', scope)
  return NextResponse.redirect(url.toString())
}
