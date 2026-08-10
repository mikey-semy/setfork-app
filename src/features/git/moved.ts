import { movedPath } from '@/shared/db/moved-list'

/**
 * Ответ git-клиенту «репозиторий переехал».
 *
 * 301, а не 308: именно за ним git-клиент следует по умолчанию — так же поступает Gitea
 * (services/context/repo.go, «Git client needs a 301 redirect by default to follow the
 * new location»). Хвост пути сохраняется целиком, поэтому
 * `.git/info/refs?service=git-upload-pack` доезжает вместе с query.
 *
 * Решение о самом перенаправлении принято раньше — в гейте доступа, вместе с проверкой
 * видимости цели. Здесь только форма ответа, без БД и без прав.
 */
export function gitMovedResponse(req: Request, repo: { owner: string; slug: string }, to: string): Response {
  const url = new URL(req.url)
  const location = new URL(movedPath(url.pathname + url.search, `/${repo.owner}/${repo.slug}`, to), url)
  return new Response(null, { status: 301, headers: { Location: location.toString() } })
}
