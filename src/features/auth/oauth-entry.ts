import 'server-only'
import { cookies } from 'next/headers'
import type { OauthProvider } from '@/shared/auth/oauth'
import { getSession, type SessionUser } from '@/shared/auth/session'
import { finishOauthLogin } from './oauth-finish'
import { linkIdentity } from './link-identity'

/**
 * ОДИН ВХОД ПРОВАЙДЕРА — ДВА НАМЕРЕНИЯ.
 *
 * Возврат от провайдера означает либо «войти», либо «привязать этот способ к аккаунту,
 * в котором я уже сижу». Различить их постфактум нельзя — намерение объявляется на
 * старте и едет в куке рядом с anti-CSRF state, живёт те же десять минут.
 *
 * Почему не отдельные роуты на привязку: обмен кода на сессию у каждого провайдера свой
 * и уже написан. Развилка нужна ровно в одной точке — после того как внешний id получен.
 */

const INTENT_COOKIE = 'oauth_intent'
const INTENT_TTL_S = 600

/**
 * Пометить, что следующий возврат ОТ ЭТОГО провайдера — привязка, а не вход.
 *
 * Провайдер записан в самой куке намеренно. Общая пометка «сейчас привязка» пережила бы
 * брошенный на полпути заход и превратила бы следующий — возможно, совсем другой — вход
 * в привязку: человек, вышедший из аккаунта, получил бы отказ вместо входа.
 */
export async function markLinkIntent(provider: OauthProvider): Promise<void> {
  const c = await cookies()
  c.set(INTENT_COOKIE, provider, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: INTENT_TTL_S,
  })
}

/** Прочитать и погасить намерение: кука одноразовая, как и state. */
async function takeIntent(provider: OauthProvider): Promise<'link' | 'login'> {
  const c = await cookies()
  const v = c.get(INTENT_COOKIE)?.value
  if (v) c.delete(INTENT_COOKIE)
  // Чужая пометка входу не мешает: она гасится, а вход идёт своим чередом.
  return v === provider ? 'link' : 'login'
}

/** Куда вести после привязки: своя секция настроек и исход словами, а не кодом. */
const linkResultUrl = (appUrl: string, provider: OauthProvider, result: string): string =>
  `${appUrl}/settings?section=sign-in&provider=${provider}&link=${result}`

/**
 * Общий финиш возврата от провайдера.
 *
 * `signIn` даёт вызывающий: обмен профиля на сессию у каждого провайдера свой (у GitHub
 * своя воронка ника, у остальных — общая), и тащить эти различия сюда значило бы собрать
 * в одном файле четыре разных API.
 */
export async function enterWithIdentity(
  provider: OauthProvider,
  externalId: string | number,
  signIn: () => Promise<SessionUser>,
  appUrl: string,
): Promise<string> {
  if ((await takeIntent(provider)) === 'link') {
    // Привязка возможна только изнутри сессии: аккаунт, к которому привязывают, обязан
    // быть доказан входом. Сессия истекла, пока человек ходил к провайдеру, — говорим
    // об этом прямо, а не заводим молча третий аккаунт.
    const session = await getSession()
    if (!session) return `${appUrl}/login?e=link_no_session`
    return linkResultUrl(appUrl, provider, await linkIdentity(session.userId, provider, externalId))
  }
  return finishOauthLogin(await signIn(), appUrl)
}
