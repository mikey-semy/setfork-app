import 'server-only'
import { headers } from 'next/headers'
import { permanentRedirect } from 'next/navigation'
import { REQUEST_PATH_HEADER } from '@/shared/request-path'
import { resolveListOrMoved, resolveUserByHandle } from './resolve-list'

/**
 * Новый адрес для запроса, пришедшего на прежний: сегмент `/owner/slug` меняется на
 * актуальный, ОСТАТОК пути и query сохраняются.
 *
 * Так же поступает Gitea (services/context/repo.go): заменяет в пути ровно кусок
 * `owner/name`, поэтому `/o/s/issues?state=open` и `/o/s.git/info/refs` доезжают до
 * своих мест, а не на корень списка.
 *
 * Отдельная функция без обращений к БД и next/navigation — чтобы правило замены можно
 * было проверить тестом, а не только вживую.
 */
export function movedPath(requestPath: string | null, from: string, to: string): string {
  if (!requestPath) return to
  if (requestPath === from) return to
  // Только точное начало сегмента: `/miki/api-old` не должен подхватываться адресом
  // `/miki/api` — иначе перенаправление уводило бы с чужого списка.
  for (const sep of ['/', '?', '.']) {
    if (requestPath.startsWith(from + sep)) return to + requestPath.slice(from.length)
  }
  return to
}

/**
 * Постоянное перенаправление с прежнего адреса на новый, с сохранением хвоста пути.
 *
 * Бросает исключение (как notFound), поэтому вызывается последним. Решение «а можно ли
 * вообще перенаправлять» принимает вызывающий: цель должна быть видна зрителю, иначе
 * старый адрес выдал бы существование скрытого списка (проверки видимости живут в
 * features, shared про них знать не может).
 *
 * 308, а не 307: адрес сменился навсегда, и клиент вправе это запомнить. Gitea по той
 * же причине отвечает 301 — временное перенаправление клиент не запоминает и ходил бы
 * по старому адресу каждый раз; в Next серверный `permanentRedirect` умеет только 308,
 * а смысл у них один.
 */
export async function permanentRedirectTo(from: string, to: string): Promise<never> {
  const requestPath = (await headers()).get(REQUEST_PATH_HEADER)
  permanentRedirect(movedPath(requestPath, from, to))
}

/**
 * Профиль открыт по ПРЕЖНЕМУ нику → перенаправление на текущий.
 *
 * Отдельно от списка, потому что здесь переехал только первый сегмент: адрес
 * `/старый-ник` и всё, что под ним (`/старый-ник/catalogs` и т.п.).
 */
export async function redirectIfUserMoved(handle: string): Promise<void> {
  const user = await resolveUserByHandle(handle)
  if (!user?.moved) return
  // Приватность профиля здесь не при чём: ник — публичная величина (он стоит в адресе
  // каждого списка человека), а закрытый профиль по НОВОМУ адресу ответит 404 сам.
  await permanentRedirectTo(`/${handle}`, `/${user.handle}`)
}
