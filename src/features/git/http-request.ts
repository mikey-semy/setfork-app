import type { GitHttpFailure } from './http-response'

/**
 * Разбор входящего запроса git smart-HTTP в ОДНУ из четырёх законных операций
 * (карточка ревью 009 и TARGET.md этой поверхности).
 *
 * Чистая функция без БД, ядра и Next: после неё невозможно получить неизвестную
 * комбинацию метода, пути и сервиса, а невалидный запрос отклоняется до любых
 * внешних зависимостей — включая базу.
 *
 * Строгость по спецификации, а не «на всякий случай»: gitprotocol-http требует,
 * чтобы у discovery был РОВНО один query-параметр `service=$servicename`. Пока
 * маршрут читал только `service` и молчал про остальные, `?service=…&foo=1`
 * обслуживался как канонический — а это разные URL для кешей и прокси при одном
 * и том же ответе.
 */
export type GitOperationKind = 'advertise-upload' | 'advertise-receive' | 'upload' | 'receive'

export interface GitHttpOperation {
  kind: GitOperationKind
  repo: { owner: string; slug: string }
  gitProtocol?: string
  /** Нужен ли этой операции доступ на запись — решает дальше authz, здесь только факт. */
  need: 'read' | 'write'
}

interface RawRequest {
  method: 'GET' | 'POST'
  handle: string
  /** Сегменты после `{owner}/{slug}` — то, что Next отдаёт в catch-all. */
  path: string[]
  slug: string
  url: string
  gitProtocol?: string
}

/** `bread.git` → `bread`: суффикс из строки клонирования, к слагу он не относится. */
const cleanSlug = (raw: string) => raw.replace(/\.git$/, '')

const SERVICES: Record<string, { advertise: GitOperationKind; need: 'read' | 'write' }> = {
  'git-upload-pack': { advertise: 'advertise-upload', need: 'read' },
  'git-receive-pack': { advertise: 'advertise-receive', need: 'write' },
}

export function parseGitHttpRequest(req: RawRequest): GitHttpOperation | GitHttpFailure {
  const repo = { owner: req.handle, slug: cleanSlug(req.slug) }
  const path = (req.path ?? []).join('/')

  if (req.method === 'GET') {
    if (path !== 'info/refs') return { code: 'not_found' }
    const query = new URL(req.url).searchParams
    const params = [...query.keys()]
    // Запрос БЕЗ параметров — это не поломка, а discovery ТУПОГО протокола:
    // «Dumb HTTP clients MUST make a GET request to $GIT_URL/info/refs, without any
    // search/query parameters» (gitprotocol-http). Мы его не обслуживаем — значит
    // «сервис недоступен», как и было до разбора файла, а не «плохой запрос».
    if (params.length === 0) return { code: 'service_not_available' }
    // А вот у умного discovery контракт жёсткий: «The request MUST contain exactly one
    // query parameter, service=$servicename… MUST NOT contain additional query
    // parameters». Лишние параметры — не мусор, который можно игнорировать: они делают
    // канонический URL неоднозначным для кешей и прокси.
    if (params.length !== 1 || params[0] !== 'service') {
      return { code: 'bad_request', detail: 'Smart HTTP discovery takes exactly one query parameter: service' }
    }
    const known = SERVICES[query.get('service') ?? '']
    // Неизвестный сервис — это не «плохой запрос», а «мы его не обслуживаем»:
    // так же отвечает git-сервер на выключенный receive-pack.
    if (!known) return { code: 'service_not_available' }
    return { kind: known.advertise, repo, gitProtocol: req.gitProtocol, need: known.need }
  }

  const known = SERVICES[path]
  if (!known) return { code: 'not_found' }
  return {
    kind: path === 'git-upload-pack' ? 'upload' : 'receive',
    repo,
    gitProtocol: req.gitProtocol,
    need: known.need,
  }
}

/** MIME ответа для каждой операции — второй половиной того же контракта провода. */
export const GIT_CONTENT_TYPE: Record<GitOperationKind, string> = {
  'advertise-upload': 'application/x-git-upload-pack-advertisement',
  'advertise-receive': 'application/x-git-receive-pack-advertisement',
  upload: 'application/x-git-upload-pack-result',
  receive: 'application/x-git-receive-pack-result',
}
