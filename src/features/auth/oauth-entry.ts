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

/** Пометить, что следующий возврат от провайдера — привязка, а не вход. */
export async function markLinkIntent(): Promise<void> {
  const c = await cookies()
  c.set(INTENT_COOKIE, 'link', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: INTENT_TTL_S,
  })
}

/**
 * ПОДСМОТРЕТЬ намерение, не гася его.
 *
 * Нужно шагу входа через Telegram: он показывается ДО возврата от провайдера, и решить,
 * пускать ли туда уже вошедшего, можно только по намерению. Гасить куку здесь нельзя —
 * её ждёт `takeIntent` в конце потока, иначе привязка снова станет входом.
 */
export async function hasLinkIntent(): Promise<boolean> {
  return (await cookies()).get(INTENT_COOKIE)?.value === 'link'
}

/** Прочитать и погасить намерение: кука одноразовая, как и state. */
async function takeIntent(): Promise<'link' | 'login'> {
  const c = await cookies()
  const v = c.get(INTENT_COOKIE)?.value
  if (v) c.delete(INTENT_COOKIE)
  return v === 'link' ? 'link' : 'login'
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
  if ((await takeIntent()) === 'link') {
    // Привязка возможна только изнутри сессии: аккаунт, к которому привязывают, обязан
    // быть доказан входом. Сессия истекла, пока человек ходил к провайдеру, — говорим
    // об этом прямо, а не заводим молча третий аккаунт.
    const session = await getSession()
    if (!session) return `${appUrl}/login?e=link_no_session`
    return linkResultUrl(appUrl, provider, await linkIdentity(session.userId, provider, externalId))
  }
  return finishOauthLogin(await signIn(), appUrl)
}
