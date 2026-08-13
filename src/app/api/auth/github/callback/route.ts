// Callback GitHub OAuth: проверяем state, меняем code на токен, тянем юзера, ставим сессию.
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { oauthEnabled } from '@/shared/auth/oauth'
import { upsertGithubUser } from '@/shared/auth/users'
import { enterWithIdentity } from '@/features/auth/oauth-entry'
import { appOrigin } from '@/shared/auth/app-origin'

export async function GET(req: NextRequest) {
  const appUrl = appOrigin()
  // Провайдер обязан проверяться на ОБОИХ концах: стартовый роут — не гейт, а удобство.
  // Иначе при AUTH_DISABLED_PROVIDERS=github обмен кода на сессию остаётся рабочим, и
  // «выключенный» вход держится только на побочном эффекте — куке state (линза 02, F6).
  if (!oauthEnabled().github) {
    return NextResponse.redirect(`${appUrl}/login?e=oauth_off`)
  }
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  const c = await cookies()
  const savedState = c.get('gh_oauth_state')?.value
  c.delete('gh_oauth_state')

  if (!code || !state || state !== savedState) {
    return NextResponse.redirect(`${appUrl}/login?e=oauth_state`)
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${appUrl}/api/auth/github/callback`,
    }),
  })
  const tokenJson = (await tokenRes.json()) as { access_token?: string }
  if (!tokenJson.access_token) {
    return NextResponse.redirect(`${appUrl}/login?e=oauth_token`)
  }

  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: 'application/vnd.github+json' },
  })
  const gh = (await userRes.json()) as {
    id: number
    login: string
    name: string | null
    avatar_url: string | null
  }
  if (!gh.id || !gh.login) {
    return NextResponse.redirect(`${appUrl}/login?e=oauth_user`)
  }

  return NextResponse.redirect(await enterWithIdentity('github', gh.id, () => upsertGithubUser(gh), appUrl))
}
