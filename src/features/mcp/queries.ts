import 'server-only'
import { desc, eq } from 'drizzle-orm'
import { apiTokens, db } from '@/shared/db'

export interface TokenRow {
  id: string
  name: string
  prefix: string
  lastUsedAt: Date | null
  createdAt: Date
}

export async function getApiTokens(userId: string): Promise<TokenRow[]> {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      lastUsedAt: apiTokens.lastUsedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt))
}
