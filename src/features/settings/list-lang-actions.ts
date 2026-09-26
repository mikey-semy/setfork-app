'use server'

import { eq } from 'drizzle-orm'
import { db, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { isContentLang } from '@/shared/i18n/iso639'

/**
 * «Язык моих списков» (ADR-0030): язык оригинала новых списков по умолчанию. `null` — не задан,
 * тогда язык интерфейса. Чужое значение не пишем: не код ISO 639-1 — отказ, прежнее цело.
 */
export async function saveMyListLang(code: string | null): Promise<{ ok: boolean }> {
  const session = await requireSession()
  if (code !== null && !isContentLang(code)) return { ok: false }
  await db.update(users).set({ listLang: code }).where(eq(users.id, session.userId))
  return { ok: true }
}
