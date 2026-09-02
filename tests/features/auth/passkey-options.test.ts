import { describe, expect, it, vi } from 'vitest'

/**
 * ⚠️ ЧЕГО НЕ ПОПРОСИШЬ, ТОГО И НЕ ПОЛУЧИШЬ.
 *
 * Не назвав нужный ключ, мы просим «любой» — и Safari на iPhone честно открывает выбор
 * из всех, начиная с чужого устройства и аппаратного ключа. Владелец 02.09.2026 вместо
 * Face ID увидел предложение приложить ключ или снять код.
 *
 * Второе: вход по passkey идёт БЕЗ allowCredentials — мы не знаем, кто пришёл, пока
 * ключ сам не назовёт владельца. Ключ без discoverable-свойства зарегистрируется
 * успешно, а при входе не найдётся: добавил и молча не работает.
 */
vi.mock('next/headers', () => ({ cookies: async () => ({ set: () => {}, get: () => undefined, delete: () => {} }) }))
vi.mock('@/shared/auth/session', () => ({ requireSession: async () => ({ userId: '00000000-0000-4000-8000-000000000001', handle: 'miki' }) }))
vi.mock('@/shared/auth/tokens', () => ({ secretKey: () => new TextEncoder().encode('x'.repeat(32)) }))
vi.mock('@/shared/db', () => ({
  db: { select: () => ({ from: () => ({ where: async () => [] }) }) },
  passkeys: { userId: 'userId', credentialId: 'credentialId', transports: 'transports' },
  users: {},
}))

const { beginPasskeyRegistration } = await import('@/features/auth/passkeys')

describe('что мы просим у телефона при добавлении passkey', () => {
  it('по умолчанию — ключ этого устройства: Face ID, а не NFC и код', async () => {
    const o = await beginPasskeyRegistration()
    expect(o.hints, 'без hints Safari открывает общий выбор способов').toContain('client-device')
    expect(o.authenticatorSelection?.authenticatorAttachment, 'подсказка для браузеров без hints').toBe('platform')
  })

  it('ключ обязан быть discoverable — иначе вход по нему не найдёт владельца', async () => {
    const o = await beginPasskeyRegistration()
    expect(o.authenticatorSelection?.residentKey).toBe('required')
  })

  it('аппаратный ключ остаётся доступен отдельной кнопкой', async () => {
    const o = await beginPasskeyRegistration('securityKey')
    expect(o.hints).toContain('security-key')
    expect(o.authenticatorSelection?.authenticatorAttachment).toBe('cross-platform')
  })
})
