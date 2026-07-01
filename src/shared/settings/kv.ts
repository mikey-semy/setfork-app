import 'server-only'
import { eq, inArray } from 'drizzle-orm'
import { appSettings, db } from '@/shared/db'

/** Чтение настроек (key-value в appSettings). Без keys — все. */
export async function getSettings(keys?: string[]): Promise<Record<string, string>> {
  const rows =
    keys && keys.length
      ? await db.select().from(appSettings).where(inArray(appSettings.key, keys))
      : await db.select().from(appSettings)
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}

export async function saveSettings(map: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(map)) {
    if (!value) {
      await db.delete(appSettings).where(eq(appSettings.key, key))
      continue
    }
    await db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
  }
}
