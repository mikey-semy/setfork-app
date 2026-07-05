import 'server-only'
import { eq } from 'drizzle-orm'
import { db, users } from '@/shared/db'

// Прочитать сохранённый вид (акцент/шрифт) для SSR-применения в layout —
// чтобы новое устройство сразу рендерилось в теме аккаунта без вспышки.
export async function getUserAppearance(userId: string): Promise<{ accent: string; font: string }> {
  const [u] = await db.select({ accent: users.uiAccent, font: users.uiFont }).from(users).where(eq(users.id, userId)).limit(1)
  return { accent: u?.accent ?? '', font: u?.font ?? '' }
}
