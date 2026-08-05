import 'server-only'
import { verifyApiToken } from '@/shared/auth/api-token'
import { captureError } from '@/shared/observability'

/**
 * Кредитив git smart-HTTP: разбор заголовка отдельно от проверки токена.
 *
 * `git` шлёт токен паролем Basic (логин любой). Разбор — чистая функция: у него нет
 * ни базы, ни сети, поэтому его можно проверить таблицей и нельзя случайно смешать с
 * решением о правах.
 */

/** Результат разбора заголовка. Пустой заголовок и мусор в нём — РАЗНЫЕ случаи. */
export type BasicCredential = { kind: 'none' } | { kind: 'malformed' } | { kind: 'ok'; user: string; secret: string }

/**
 * RFC 7617: `Basic <base64(user-id ":" password)>`, и разделитель обязателен.
 *
 * Раньше пароль брали как `decoded.slice(decoded.indexOf(':') + 1)`: при отсутствии
 * двоеточия `indexOf` возвращает −1, после `+1` выходит 0, и паролем становилась вся
 * строка. То есть `Basic base64("sf_...")` принимался наравне с нормальным
 * `<user>:sf_...` (карточка ревью 010). Прав это не повышало — секрет всё равно надо
 * знать, — но граница принимала форму провода, которой в спецификации нет, и общего
 * строгого контракта у парсера не было.
 *
 * Заголовок и секрет НЕ логируются здесь ни при каком исходе.
 */
export function parseBasicCredential(header: string | null): BasicCredential {
  const raw = header ?? ''
  if (!raw.toLowerCase().startsWith('basic ')) return { kind: 'none' }
  const encoded = raw.slice(6).trim()
  if (!encoded) return { kind: 'malformed' }
  let decoded: string
  try {
    const buf = Buffer.from(encoded, 'base64')
    // Buffer.from не бросает на мусоре — он молча пропускает невалидные символы.
    // Сверяем обратной кодировкой: расхождение значит, что это не base64.
    if (buf.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) return { kind: 'malformed' }
    decoded = buf.toString('utf8')
  } catch {
    return { kind: 'malformed' }
  }
  const sep = decoded.indexOf(':')
  if (sep < 0) return { kind: 'malformed' }
  return { kind: 'ok', user: decoded.slice(0, sep), secret: decoded.slice(sep + 1) }
}

/** Кто пришёл: личность доказана, не доказана, либо доказать НЕ УДАЛОСЬ (авария хранилища). */
export type GitIdentity =
  | { kind: 'anonymous' }
  | { kind: 'rejected' }
  | { kind: 'unavailable' }
  | { kind: 'user'; userId: string; scope: 'read' | 'write' }

/**
 * Личность по заголовку Authorization.
 *
 * «Токен не принят» и «хранилище токенов не отвечает» разделены намеренно: 401 на
 * аварию говорит человеку «ваш токен не годится» про исправный токен, он идёт
 * перевыпускать секрет, а CI записывает отказ доступа вместо аварии (карточка 005).
 */
export async function identifyGitActor(header: string | null): Promise<GitIdentity> {
  const cred = parseBasicCredential(header)
  if (cred.kind === 'none') return { kind: 'anonymous' }
  if (cred.kind === 'malformed') return { kind: 'rejected' }
  try {
    const auth = await verifyApiToken(cred.secret)
    return auth ? { kind: 'user', userId: auth.userId, scope: auth.scope } : { kind: 'rejected' }
  } catch (e) {
    captureError(e, { where: 'git.auth' })
    return { kind: 'unavailable' }
  }
}
