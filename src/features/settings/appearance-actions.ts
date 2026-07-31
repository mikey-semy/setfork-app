'use server'

import { eq } from 'drizzle-orm'
import { db, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'

// Синхронизация вида (акцент/шрифт) в аккаунт — чтобы настройки следовали за
// пользователем между устройствами. Тема (light/dark/system) остаётся за
// next-themes (localStorage). Значения валидируем по белым спискам.
const ACCENT_VALUES = new Set(['', 'violet', 'green', 'orange', 'rose', 'teal'])
const FONT_VALUES = new Set(['', 'inter', 'manrope', 'system'])
const SCALE_VALUES = new Set(['', '90', '110']) // '' = 100%; проценты корневого font-size (все размеры в rem, Ф6)

/** Обновляет ТОЛЬКО переданные поля: локальный стейт устройства может
 *  расходиться с аккаунтом (выбор на другом устройстве), и смена одного
 *  предпочтения не должна затирать остальные локальной копией (Codex #623). */
export async function saveAppearance(patch: { accent?: string; font?: string; scale?: string }): Promise<{ ok: boolean }> {
  const session = await requireSession()
  const set: { uiAccent?: string; uiFont?: string; uiScale?: string } = {}
  if (patch.accent !== undefined) {
    if (!ACCENT_VALUES.has(patch.accent)) return { ok: false }
    set.uiAccent = patch.accent
  }
  if (patch.font !== undefined) {
    if (!FONT_VALUES.has(patch.font)) return { ok: false }
    set.uiFont = patch.font
  }
  if (patch.scale !== undefined) {
    if (!SCALE_VALUES.has(patch.scale)) return { ok: false }
    set.uiScale = patch.scale
  }
  if (Object.keys(set).length === 0) return { ok: false }
  await db.update(users).set(set).where(eq(users.id, session.userId))
  return { ok: true }
}
