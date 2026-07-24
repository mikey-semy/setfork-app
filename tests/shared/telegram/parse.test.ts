import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseConfirmToken, parseStartToken, telegramLoginCode } from '@/shared/telegram'

const HEX32 = 'a'.repeat(32)

describe('parseStartToken', () => {
  it('валидный /start с токеном', () => {
    expect(parseStartToken(`/start tl_${HEX32}`)).toBe(HEX32)
  })

  it('голый /start, чужой payload и мусор → null', () => {
    expect(parseStartToken('/start')).toBeNull()
    expect(parseStartToken(`/start ${HEX32}`)).toBeNull()
    expect(parseStartToken(`/start tl_XYZ`)).toBeNull()
    expect(parseStartToken(`/start tl_${'a'.repeat(10)}`)).toBeNull()
    expect(parseStartToken(undefined)).toBeNull()
    expect(parseStartToken(`x /start tl_${HEX32}`)).toBeNull()
  })
})

describe('parseConfirmToken', () => {
  it('валидная callback_data', () => {
    expect(parseConfirmToken(`tglogin:${HEX32}`)).toBe(HEX32)
  })

  it('мусор → null', () => {
    expect(parseConfirmToken('tglogin:')).toBeNull()
    expect(parseConfirmToken(HEX32)).toBeNull()
    expect(parseConfirmToken(undefined)).toBeNull()
  })
})

describe('telegramLoginCode (F2 — привязка входа к инициатору)', () => {
  const prev = process.env.AUTH_SECRET
  beforeAll(() => {
    process.env.AUTH_SECRET = 'test-secret-123'
  })
  afterAll(() => {
    if (prev === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = prev
  })

  it('6 цифр и детерминирован (webhook и poll считают одинаково)', () => {
    const a = telegramLoginCode(HEX32, 42)
    expect(a).toMatch(/^\d{6}$/)
    expect(telegramLoginCode(HEX32, 42)).toBe(a)
  })

  it('зависит от секрета (без AUTH_SECRET код другой)', () => {
    const withSecret = telegramLoginCode(HEX32, 42)
    process.env.AUTH_SECRET = ''
    const noSecret = telegramLoginCode(HEX32, 42)
    process.env.AUTH_SECRET = 'test-secret-123'
    expect(noSecret).toMatch(/^\d{6}$/)
    expect(noSecret).not.toBe(withSecret)
  })
})
