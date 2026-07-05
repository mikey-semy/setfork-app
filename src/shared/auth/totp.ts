// TOTP (RFC 6238, HMAC-SHA1, 6 цифр, шаг 30с) + шифрование секрета и
// recovery-коды. Чистый node:crypto, без внешних зависимостей.
// Секрет в БД лежит ЗАШИФРОВАННЫМ (AES-256-GCM, ключ выводится из AUTH_SECRET).

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** Новый секрет пользователя (20 байт → base32, стандарт аутентификаторов). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

/** Код для конкретного счётчика времени (экспорт для окна проверки и тестов). */
export function totpAt(secretB32: string, epochMs: number, stepSec = 30, digits = 6): string {
  const counter = Math.floor(epochMs / 1000 / stepSec)
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const h = createHmac('sha1', base32Decode(secretB32)).update(msg).digest()
  const off = h[h.length - 1] & 0x0f
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]
  return String(code % 10 ** digits).padStart(digits, '0')
}

/** Проверка с окном ±window шагов; возвращает совпавший счётчик времени (step)
 *  для anti-replay или -1, если код неверен. Часы клиента могут плыть → окно. */
export function verifyTotpStep(secretB32: string, code: string, window = 1, nowMs = Date.now()): number {
  const clean = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(clean)) return -1
  for (let w = -window; w <= window; w++) {
    const ms = nowMs + w * 30_000
    const expected = totpAt(secretB32, ms)
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return Math.floor(ms / 1000 / 30)
  }
  return -1
}

/** Проверка с окном ±window шагов (часы клиента могут плыть). */
export function verifyTotp(secretB32: string, code: string, window = 1, nowMs = Date.now()): boolean {
  return verifyTotpStep(secretB32, code, window, nowMs) >= 0
}

export function otpauthUrl(handle: string, secretB32: string): string {
  const issuer = 'SetFork'
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(handle)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}

// ── Шифрование секрета (AES-256-GCM; iv+tag+ct в base64) ─────────────
function encKey(): Buffer {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not set')
  return createHash('sha256').update(`totp:${secret}`).digest()
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')
}

export function decryptSecret(stored: string): string | null {
  try {
    const raw = Buffer.from(stored, 'base64')
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const ct = raw.subarray(28)
    const d = createDecipheriv('aes-256-gcm', encKey(), iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
  } catch {
    return null // битые данные/смена AUTH_SECRET
  }
}

// ── Recovery-коды: показываются один раз, храним только sha256 ────────
export function generateRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const raw = randomBytes(5).toString('hex') // 10 hex-символов
    return `${raw.slice(0, 5)}-${raw.slice(5)}`
  })
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase()).digest('hex')
}
