// Старт ПРИВЯЗКИ способа входа: POST → кука намерения → редирект к провайдеру.
//
// Почему отдельный роут и почему POST, а не `?intent=link` на обычном старте: пометка
// намерения — побочный эффект, а GET префетчится браузером и подделывается чужой
// страницей. Привязка меняет то, кто сможет войти под аккаунтом, поэтому начинается
// явным действием из формы, в сессии и с проверкой провайдера.
import { NextResponse, type NextRequest } from 'next/server'
import { getSession } from '@/shared/auth/session'
import { oauthEnabled, type OauthProvider } from '@/shared/auth/oauth'
import { IDENTITY_PROVIDERS } from '@/shared/auth/identities'
import { appOrigin } from '@/shared/auth/app-origin'
import { markLinkIntent } from '@/features/auth/oauth-entry'

export async function POST(req: NextRequest) {
  const appUrl = appOrigin()
  // Привязывать можно только к аккаунту, в котором уже сидишь: без сессии непонятно,
  // к чему привязывать, и любой переход по ссылке заводил бы новый аккаунт.
  const session = await getSession()
  if (!session) return NextResponse.redirect(`${appUrl}/login`, { status: 303 })

  const form = await req.formData()
  const provider = String(form.get('provider') ?? '') as OauthProvider
  if (!IDENTITY_PROVIDERS.includes(provider) || !oauthEnabled()[provider]) {
    return NextResponse.redirect(`${appUrl}/settings?section=sign-in&link=unavailable`, { status: 303 })
  }

  await markLinkIntent(provider)
  // 303: после POST браузер обязан пойти на провайдера методом GET.
  return NextResponse.redirect(`${appUrl}/api/auth/${provider}`, { status: 303 })
}
