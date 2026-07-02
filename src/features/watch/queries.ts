import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { db, watches } from '@/shared/db'

export async function isWatching(userId: string, templateId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: watches.id })
    .from(watches)
    .where(and(eq(watches.userId, userId), eq(watches.templateId, templateId)))
    .limit(1)
  return !!row
}

export async function getWatchCount(templateId: string): Promise<number> {
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(watches)
    .where(eq(watches.templateId, templateId))
  return r?.c ?? 0
}

/** ID всех наблюдателей списка (для рассылки уведомлений). */
export async function getWatcherIds(templateId: string): Promise<string[]> {
  const rows = await db.select({ id: watches.userId }).from(watches).where(eq(watches.templateId, templateId))
  return rows.map((r) => r.id)
}
