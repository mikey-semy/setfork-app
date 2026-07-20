import { describe, expect, it } from 'vitest'
import { parseConfirmToken, parseStartToken } from '@/shared/telegram'

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
