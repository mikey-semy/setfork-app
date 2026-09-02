/**
 * Разбор отказа браузера при добавлении passkey.
 *
 * ⚠️ ОДНО СООБЩЕНИЕ НА ВСЕ ОТКАЗЫ — ЭТО ТИХАЯ ДЕГРАДАЦИЯ. Раньше любой отказ показывал
 * «Отменено или не поддерживается браузером», хотя самый частый случай на телефоне —
 * `InvalidStateError`: ключ для этого сайта уже лежит в связке ключей, и браузер
 * отказывается заводить второй. Человек читал про «не поддерживается» и уходил.
 *
 * Модуль намеренно не серверный: разбирать отказ нужно там, где он случился.
 */
export type PasskeyKind = 'device' | 'securityKey'

export type PasskeyErrorKey =
  | 'auth.passkey.alreadyOnDevice'
  | 'auth.passkey.cancelled'
  | 'auth.passkey.unsupported'
  | 'auth.passkey.failed'

export function passkeyErrorKey(e: unknown): PasskeyErrorKey {
  const name = e instanceof Error ? e.name : ''
  switch (name) {
    // Ключ этого сайта уже есть на устройстве (сработал excludeCredentials).
    case 'InvalidStateError':
      return 'auth.passkey.alreadyOnDevice'
    // Отказ пользователя И истёкшее ожидание приходят одним именем — браузер намеренно
    // не разделяет их, чтобы сайт не мог отличить «передумал» от «не смог».
    case 'NotAllowedError':
    case 'AbortError':
      return 'auth.passkey.cancelled'
    case 'NotSupportedError':
    case 'SecurityError':
      return 'auth.passkey.unsupported'
    default:
      return 'auth.passkey.failed'
  }
}
