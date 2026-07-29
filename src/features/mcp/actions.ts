'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { apiTokens, db } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { newToken } from '@/shared/auth/api-token'
import { recordAudit } from '@/shared/audit'

/** Создать API-токен. Возвращает ПОЛНЫЙ токен один раз (больше нигде не покажем). */
export async function createApiToken(name: string, scope: 'read' | 'write' = 'write', expiresInDays?: number): Promise<{ token: string } | { error: string }> {
  const session = await requireSession()
  const label = name.trim().slice(0, 60) || 'token'
  // Ровно два допустимых значения; всё прочее — 'read' (см. verifyApiToken: там
  // неизвестное значение тоже отнимает права, а не добавляет).
  const sc = scope === 'write' ? 'write' : 'read'
  const expiresAt = expiresInDays && expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 86_400_000) : null
  const { token, hash, prefix } = newToken()
  await db.insert(apiTokens).values({ userId: session.userId, name: label, tokenHash: hash, prefix, scope: sc, expiresAt })
  await recordAudit('token.create', { actorId: session.userId, targetType: 'token', meta: { name: label, scope: sc, expiresInDays: expiresInDays ?? null } })
  revalidatePath('/settings')
  return { token }
}

export async function revokeApiToken(id: string): Promise<void> {
  const session = await requireSession()
  await db.delete(apiTokens).where(and(eq(apiTokens.id, id), eq(apiTokens.userId, session.userId)))
  await recordAudit('token.revoke', { actorId: session.userId, targetType: 'token', targetId: id })
  revalidatePath('/settings')
}
