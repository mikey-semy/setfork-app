import 'server-only'
import { eq } from 'drizzle-orm'
import { db, watches } from '@/shared/db'
import { curationStore } from '@/features/curation/adapter'

// Тонкие обёртки над портом CurationStore — потребители не меняются, логика в адаптере.
export const isWatching = (userId: string, templateId: string) => curationStore.isWatching(templateId, userId)
export const getWatchCount = (templateId: string) => curationStore.watchCount(templateId)
export const getWatcherIds = (templateId: string) => curationStore.watcherIds(templateId)

/** ID списков, за которыми следит пользователь (для ленты дашборда). Не в порту CurationStore. */
export async function getWatchedIds(userId: string): Promise<string[]> {
  const rows = await db.select({ id: watches.templateId }).from(watches).where(eq(watches.userId, userId))
  return rows.map((r) => r.id)
}
