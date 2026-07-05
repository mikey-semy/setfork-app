import { beforeAll, describe, expect, it } from 'vitest'
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUrl,
  totpAt,
  verifyTotp,
} from './totp'

// RFC 6238 Appendix B (SHA1): секрет ASCII '12345678901234567890';
// эталонные 8-значные коды — берём последние 6 цифр.
const RFC_SECRET_B32 = base32Encode(Buffer.from('12345678901234567890', 'ascii'))
const RFC = [
  { t: 59_000, code8: '94287082' },
  { t: 1_111_111_109_000, code8: '07081804' },
  { t: 1_111_111_111_000, code8: '14050471' },
  { t: 1_234_567_890_000, code8: '89005924' },
  { t: 2_000_000_000_000, code8: '69279037' },
]

beforeAll(() => {
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-for-totp-unit'
})

describe('base32', () => {
  it('roundtrips', () => {
    const buf = Buffer.from('hello world, привет', 'utf8')
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true)
  })
  it('encodes RFC secret to expected prefix', () => {
    expect(RFC_SECRET_B32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  })
})

describe('totp (RFC 6238 vectors, SHA1/30s)', () => {
  for (const { t, code8 } of RFC) {
    it(`T=${t / 1000} → …${code8.slice(-6)}`, () => {
      expect(totpAt(RFC_SECRET_B32, t)).toBe(code8.slice(-6))
    })
  }
})

describe('verifyTotp', () => {
  it('accepts current and ±1 window, rejects outside', () => {
    const now = 1_111_111_109_000
    const code = totpAt(RFC_SECRET_B32, now)
    expect(verifyTotp(RFC_SECRET_B32, code, 1, now)).toBe(true)
    expect(verifyTotp(RFC_SECRET_B32, code, 1, now + 30_000)).toBe(true) // прошлый шаг в окне
    expect(verifyTotp(RFC_SECRET_B32, code, 1, now + 90_000)).toBe(false)
  })
  it('rejects garbage', () => {
    expect(verifyTotp(RFC_SECRET_B32, 'abc123')).toBe(false)
    expect(verifyTotp(RFC_SECRET_B32, '12345')).toBe(false)
  })
})

describe('secret encryption', () => {
  it('roundtrips and tolerates tampering', () => {
    const secret = generateTotpSecret()
    const enc = encryptSecret(secret)
    expect(enc).not.toContain(secret)
    expect(decryptSecret(enc)).toBe(secret)
    expect(decryptSecret(enc.slice(0, -4) + 'AAAA')).toBeNull()
  })
})

describe('recovery codes', () => {
  it('generates 10 unique xxxxx-xxxxx codes; hash is stable and case/space-insensitive', () => {
    const codes = generateRecoveryCodes()
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    for (const c of codes) expect(c).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/)
    expect(hashRecoveryCode(` ${codes[0].toUpperCase()} `)).toBe(hashRecoveryCode(codes[0]))
  })
})

describe('otpauth url', () => {
  it('includes issuer and secret', () => {
    const url = otpauthUrl('mike', 'ABC234')
    expect(url).toContain('otpauth://totp/SetFork:mike')
    expect(url).toContain('secret=ABC234')
  })
})
