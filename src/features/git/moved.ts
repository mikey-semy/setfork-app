import 'server-only'
import { movedPath } from '@/shared/db/moved-list'
import { resolveListOrMoved } from '@/shared/db/resolve-list'

/**
 * Запрос git пришёл на ПРЕЖНИЙ адрес списка → ответ с перенаправлением; иначе null
 * (вызывающий отвечает обычным отказом).
 *
 * Зачем вообще: адрес живёт в `git remote` у всех, кто клонировал. Переименование без
 * этого превращало бы каждый такой клон в мёртвый — человек узнавал бы о смене адреса
 * от `fatal: repository not found`.
 *
 * 301, а не 308: именно его git-клиент запоминает и следует за ним по умолчанию — так
 * же поступает Gitea (services/context/repo.go, «Git client needs a 301 redirect by
 * default to follow the new location»). Хвост пути сохраняется целиком, поэтому
 * `.git/info/refs?service=git-upload-pack` доезжает вместе с query.
 *
 * Стоит запроса к БД только на промахе — то есть там, где ответом всё равно был бы 404.
 */
export async function gitMovedResponse(req: Request, repo: { owner: string; slug: string }): Promise<Response | null> {
  const found = await resolveListOrMoved(repo.owner, repo.slug)
  if (!found?.movedTo) return null

  const url = new URL(req.url)
  const from = `/${repo.owner}/${repo.slug}`
  const location = new URL(movedPath(url.pathname + url.search, from, found.movedTo), url)
  return new Response(null, { status: 301, headers: { Location: location.toString() } })
}
