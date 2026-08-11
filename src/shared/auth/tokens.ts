import 'server-only'
import { SignJWT, jwtVerify } from 'jose'

// Подпись коротких ссылок-токенов (подтверждение почты, сброс пароля, отписка,
// challenge passkey). Живёт в shared: токены нужны и фичам, и слою писем, а
// кросс-импорт фич запрещён границами слоёв.

export function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET
  if (!s) throw new Error('AUTH_SECRET is not set')
  return new TextEncoder().encode(s)
}

export async function signToken(payload: Record<string, string>, ttl: string): Promise<string> {
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(ttl).sign(secretKey())
}

export async function readToken(token: string): Promise<Record<string, string> | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey())
    return payload as Record<string, string>
  } catch {
    return null
  }
}
