import 'server-only'

/**
 * Единый контракт ОТКАЗОВ git smart-HTTP (карточка ревью 006).
 *
 * Раньше каждая ветка маршрута собирала `new Response` по месту: четыре независимых
 * «not found», один текст про «слишком большой push» даже на чтении, JSON у лимитера
 * среди plain-text соседей, а инфраструктурные исключения обходили это всё стороной.
 * Статус, машинный код, текст и заголовки не были связаны ничем, кроме внимательности.
 *
 * Общий REST-хелпер сюда не годится: git smart-HTTP — отдельный протокол со своими
 * статусами, `WWW-Authenticate`, MIME `application/x-git-*` и запретом кеширования
 * (gitprotocol-http). Унифицируем ВНУТРИ границы, а не заставляем её притворяться
 * обычным `/api/*`.
 *
 * Union + один exhaustive mapper: новый класс отказа компилятор потребует обработать.
 */
export type GitHttpFailure =
  /** Кредитив не предъявлен либо не принят. Единственный ответ, который просит пароль. */
  | { code: 'auth_required' }
  /** Нет объекта ЛИБО он не виден этому актору — ответ одинаковый, иначе транспорт перечисляет чужое. */
  | { code: 'not_found' }
  /** Личность доказана, объект виден, операция не разрешена. Повторный пароль ничего не изменит. */
  | { code: 'access_denied'; detail: string }
  /** Запись запрещена состоянием списка. Причину домен знает — не смешиваем с правами. */
  | { code: 'write_disabled'; reason: 'archived' | 'frozen' }
  /** Запрос не соответствует протоколу (путь, набор query, сервис, кодировка тела). */
  | { code: 'bad_request'; detail: string }
  /** Сервис существует, но этим транспортом не обслуживается. */
  | { code: 'service_not_available' }
  /** Тело больше потолка — на чтении и на записи текст разный, потолок один. */
  | { code: 'body_too_large'; maxBytes: number; operation: 'read' | 'write' }
  /** Хранилище токенов недоступно: это авария, а не «неверный пароль» (карточка 005). */
  | { code: 'auth_unavailable' }
  /** Ядро недоступно/не ответило вовремя — временно, повторить осмысленно. */
  | { code: 'core_unavailable'; kind: 'unavailable' | 'timeout' }
  /** Ядро ответило ошибкой, которая не является ни одним из перечисленных случаев. */
  | { code: 'core_error' }
  /** Слишком часто. Держим здесь же, чтобы у границы не было ответа мимо контракта. */
  | { code: 'rate_limited'; retryAfter: number }

/** Ответ протокола не кешируется никем и никогда (gitprotocol-http §Smart Clients). */
export const gitNoCache = {
  Expires: 'Fri, 01 Jan 1980 00:00:00 GMT',
  Pragma: 'no-cache',
  'Cache-Control': 'no-cache, max-age=0, must-revalidate',
} as const

const TEXT = 'text/plain; charset=utf-8'

/** Текст отказа — английский, как и весь git-инструментарий: его читает и человек, и лог CI. */
function body(f: GitHttpFailure): string {
  switch (f.code) {
    case 'auth_required':
      return 'Authentication required\n'
    case 'not_found':
      return 'Repository not found\n'
    case 'access_denied':
      return `${f.detail}\n`
    case 'write_disabled':
      return `List is ${f.reason}: writes are disabled\n`
    case 'bad_request':
      return `${f.detail}\n`
    case 'service_not_available':
      return 'Service not available\n'
    case 'body_too_large':
      return f.operation === 'write'
        ? `Push is too large: the limit is ${mb(f.maxBytes)} MB per request.\n` +
            'A list is text — this usually means binaries got committed. Keep images and attachments out of the repository.\n'
        : `Request is too large: the limit is ${mb(f.maxBytes)} MB per request.\n`
    case 'auth_unavailable':
      return 'Authentication is temporarily unavailable, retry later\n'
    case 'core_unavailable':
      return f.kind === 'timeout' ? 'Repository operation timed out, retry later\n' : 'Repository storage is temporarily unavailable, retry later\n'
    case 'core_error':
      return 'Repository backend error\n'
    case 'rate_limited':
      return 'Too many requests, retry later\n'
  }
}

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024)

function status(f: GitHttpFailure): number {
  switch (f.code) {
    case 'auth_required':
      return 401
    case 'not_found':
      return 404
    case 'access_denied':
    case 'write_disabled':
    case 'service_not_available':
      return 403
    case 'bad_request':
      return 400
    case 'body_too_large':
      return 413
    case 'auth_unavailable':
      return 503
    case 'core_unavailable':
      return f.kind === 'timeout' ? 504 : 503
    case 'core_error':
      return 502
    case 'rate_limited':
      return 429
  }
}

function extraHeaders(f: GitHttpFailure): Record<string, string> {
  // Только 401 просит кредитив: git-клиент по нему идёт в credential helper и
  // спрашивает секрет заново. На 403 это было бы предложением ввести пароль ещё раз
  // там, где пароль ни при чём (карточка 012).
  if (f.code === 'auth_required') return { 'WWW-Authenticate': 'Basic realm="SetFork", charset="UTF-8"' }
  if (f.code === 'auth_unavailable') return { 'Retry-After': '30' }
  if (f.code === 'core_unavailable') return { 'Retry-After': '30' }
  if (f.code === 'rate_limited') return { 'Retry-After': String(f.retryAfter) }
  return {}
}

/** Отказ → ответ протокола. Единственное место, где рождается HTTP-статус git-границы. */
export function gitFailureResponse(f: GitHttpFailure): Response {
  return new Response(body(f), { status: status(f), headers: { 'Content-Type': TEXT, ...gitNoCache, ...extraHeaders(f) } })
}

/** Успешный ответ протокола: MIME задаёт сама операция, кеш запрещён всем. */
export function gitBytesResponse(bytes: Uint8Array, contentType: string): Response {
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': contentType, ...gitNoCache } })
}
