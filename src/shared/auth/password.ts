import 'server-only'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// Хеш пароля через встроенный scrypt (без внешних зависимостей).
// Формат: scrypt$<saltHex>$<hashHex>.
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false
  const [alg, saltHex, hashHex] = stored.split('$')
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
