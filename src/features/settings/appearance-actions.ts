'use server'

import { eq } from 'drizzle-orm'
import { db, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'

// Синхронизация вида (акцент/шрифт) в аккаунт — чтобы настройки следовали за
// пользователем между устройствами. Тема (light/dark/system) остаётся за
// next-themes (localStorage). Значения валидируем по белым спискам.
const ACCENT_VALUES = new Set(['', 'violet', 'green', 'orange', 'rose', 'teal'])
const FONT_VALUES = new Set(['', 'inter', 'manrope', 'system'])

export async function saveAppearance(accent: string, font: string): Promise<{ ok: boolean }> {
  const session = await requireSession()
  if (!ACCENT_VALUES.has(accent) || !FONT_VALUES.has(font)) return { ok: false }
  await db.update(users).set({ uiAccent: accent, uiFont: font }).where(eq(users.id, session.userId))
  return { ok: true }
}
