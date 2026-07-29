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

export type TokenScope = 'read' | 'write'
export type TokenAuth = { userId: string; scope: TokenScope }

/** Истёк ли токен (чистая проверка — тестируемо). */
export function tokenExpired(expiresAt: Date | null | undefined, now = Date.now()): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() < now
}

/** Проверка Bearer-токена → { userId, scope } или null (истёкшие отклоняются). Обновляет last_used_at. */
export async function verifyApiToken(token: string | undefined): Promise<TokenAuth | null> {
  if (!token || !token.startsWith(PREFIX)) return null
  const [row] = await db
    .select({ id: apiTokens.id, userId: apiTokens.userId, scope: apiTokens.scope, expiresAt: apiTokens.expiresAt })
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hashToken(token)))
    .limit(1)
  if (!row || tokenExpired(row.expiresAt)) return null
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id))
  // FAIL-CLOSED: правом записи считается ТОЛЬКО точное 'write'. Колонка — свободный
  // текст, и прежнее «всё, что не read → write» означало, что опечатка, пустая строка
  // или значение из будущей версии молча выдавали полный доступ. Неизвестное значение
  // должно ОТНИМАТЬ права, а не добавлять.
  return { userId: row.userId, scope: row.scope === 'write' ? 'write' : 'read' }
}
