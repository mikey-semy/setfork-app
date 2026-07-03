import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { apiTokens, db } from '@/shared/db'

const PREFIX = 'sf_'

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Новый токен: полный (показать один раз), его hash и prefix для отображения. */
export function newToken(): { token: string; hash: string; prefix: string } {
  const raw = randomBytes(24).toString('hex') // 48 hex-символов
  const token = PREFIX + raw
  return { token, hash: hashToken(token), prefix: `${PREFIX}${raw.slice(0, 6)}…` }
}

/** Проверка Bearer-токена → userId или null. Обновляет last_used_at. */
export async function verifyApiToken(token: string | undefined): Promise<string | null> {
  if (!token || !token.startsWith(PREFIX)) return null
  const [row] = await db
    .select({ id: apiTokens.id, userId: apiTokens.userId })
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hashToken(token)))
    .limit(1)
  if (!row) return null
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id))
  return row.userId
}
