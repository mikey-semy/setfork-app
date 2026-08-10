import 'server-only'
import { headers } from 'next/headers'
import { permanentRedirect } from 'next/navigation'
import { REQUEST_PATH_HEADER } from '@/shared/request-path'
import { resolveListOrMoved } from './resolve-list'

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
 * Список открыт по ПРЕЖНЕМУ адресу → постоянное перенаправление на текущий.
 *
 * Возврат означает «такого списка нет вообще» — вызывающий отвечает как обычно
 * (notFound). Перенаправление бросает исключение, как и notFound, поэтому код после
 * вызова выполняется только в случае «не найдено».
 *
 * 308, а не 307: адрес сменился навсегда, и клиент вправе это запомнить. Gitea по той
 * же причине отвечает 301 — временное перенаправление git-клиент не запоминает и
 * ходил бы по старому адресу каждый раз.
 */
export async function redirectIfListMoved(owner: string, slug: string): Promise<void> {
  const found = await resolveListOrMoved(owner, slug)
  if (!found?.movedTo) return
  const requestPath = (await headers()).get(REQUEST_PATH_HEADER)
  permanentRedirect(movedPath(requestPath, `/${owner}/${slug}`, found.movedTo))
}
