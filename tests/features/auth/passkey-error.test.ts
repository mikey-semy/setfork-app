import { describe, expect, it } from 'vitest'
import { passkeyErrorKey } from '@/shared/auth/passkey-error'

/** Отказ браузера называем: одно «не поддерживается» на все случаи уводило в сторону. */
describe('разбор отказа при добавлении passkey', () => {
  const err = (name: string) => Object.assign(new Error('x'), { name })

  it('ключ уже на устройстве — самый частый случай на телефоне', () => {
    expect(passkeyErrorKey(err('InvalidStateError'))).toBe('auth.passkey.alreadyOnDevice')
  })

  it('передумал или не успел — браузер намеренно не разделяет эти два', () => {
    expect(passkeyErrorKey(err('NotAllowedError'))).toBe('auth.passkey.cancelled')
    expect(passkeyErrorKey(err('AbortError'))).toBe('auth.passkey.cancelled')
  })

  it('браузер не умеет passkey', () => {
    expect(passkeyErrorKey(err('NotSupportedError'))).toBe('auth.passkey.unsupported')
    expect(passkeyErrorKey(err('SecurityError'))).toBe('auth.passkey.unsupported')
  })

  it('незнакомое и не-Error не притворяются понятным отказом', () => {
    expect(passkeyErrorKey(err('WeirdError'))).toBe('auth.passkey.failed')
    expect(passkeyErrorKey('строка')).toBe('auth.passkey.failed')
  })
})
