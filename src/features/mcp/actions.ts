'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { apiTokens, db } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { newToken } from '@/shared/auth/api-token'

/** Создать API-токен. Возвращает ПОЛНЫЙ токен один раз (больше нигде не покажем). */
export async function createApiToken(name: string): Promise<{ token: string } | { error: string }> {
  const session = await requireSession()
  const label = name.trim().slice(0, 60) || 'token'
  const { token, hash, prefix } = newToken()
  await db.insert(apiTokens).values({ userId: session.userId, name: label, tokenHash: hash, prefix })
  revalidatePath('/settings')
  return { token }
}

export async function revokeApiToken(id: string): Promise<void> {
  const session = await requireSession()
  await db.delete(apiTokens).where(and(eq(apiTokens.id, id), eq(apiTokens.userId, session.userId)))
  revalidatePath('/settings')
}
