// Callback VK ID: state → обмен кода (PKCE: code_verifier + device_id из
// callback-параметров) → oauth2/user_info → сессия.
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { upsertOauthUser } from '@/shared/auth/users'
import { enterWithIdentity } from '@/features/auth/oauth-entry'
import { appOrigin } from '@/shared/auth/app-origin'

export async function GET(req: NextRequest) {
  const appUrl = appOrigin()
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const deviceId = searchParams.get('device_id')

  const c = await cookies()
  const savedState = c.get('vk_oauth_state')?.value
  const verifier = c.get('vk_code_verifier')?.value
  c.delete('vk_oauth_state')
  c.delete('vk_code_verifier')

  if (!code || !state || state !== savedState || !verifier || !deviceId) {
    return NextResponse.redirect(`${appUrl}/login?e=oauth_state`)
  }

  const tokenRes = await fetch('https://id.vk.com/oauth2/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: process.env.VK_CLIENT_ID ?? '',
      device_id: deviceId,
      redirect_uri: `${appUrl}/api/auth/vk/callback`,
      state,
    }),
  })
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; user_id?: number }
  if (!tokenJson.access_token) {
    return NextResponse.redirect(`${appUrl}/login?e=oauth_token`)
  }

  const infoRes = await fetch('https://id.vk.com/oauth2/user_info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.VK_CLIENT_ID ?? '', access_token: tokenJson.access_token }),
  })
  const info = (await infoRes.json().catch(() => ({}))) as {
    user?: {
      user_id?: string | number
      first_name?: string | null
      last_name?: string | null
      avatar?: string | null
      email?: string | null
    }
  }
  const vkUserId = info.user?.user_id ?? tokenJson.user_id
  if (!vkUserId) {
    return NextResponse.redirect(`${appUrl}/login?e=oauth_user`)
  }

  const name = [info.user?.first_name, info.user?.last_name].filter(Boolean).join(' ') || null
  const profile = {
    externalId: Number(vkUserId),
    handleCandidates: [info.user?.email?.split('@')[0], name, `vk${vkUserId}`],
    name,
    avatarUrl: info.user?.avatar || null,
    email: info.user?.email,
  }
  return NextResponse.redirect(await enterWithIdentity('vk', Number(vkUserId), () => upsertOauthUser('vk', profile), appUrl))
}
