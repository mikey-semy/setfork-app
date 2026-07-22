import 'server-only'
import { eq } from 'drizzle-orm'
import type { WatchEvent } from '@/core'
import { db, watches } from '@/shared/db'
import { curationStore } from '@/features/curation/store'

// Тонкие обёртки над портом CurationStore — потребители не меняются, логика в адаптере.
export const isWatching = (userId: string, templateId: string) => curationStore.isWatching(templateId, userId)
export const getWatchCount = (templateId: string) => curationStore.watchCount(templateId)
/** Кому слать событие данного типа (уважает уровень подписки). */
export const getWatcherIds = (templateId: string, event: WatchEvent) => curationStore.watcherIds(templateId, event)
/** Текущее состояние подписки зрителя (для дропдауна Watch). */
export const getWatchState = (userId: string, templateId: string) => curationStore.watchState(templateId, userId)

/** ID списков, за которыми следит пользователь (для ленты дашборда). Не в порту CurationStore. */
export async function getWatchedIds(userId: string): Promise<string[]> {
  const rows = await db.select({ id: watches.templateId }).from(watches).where(eq(watches.userId, userId))
  return rows.map((r) => r.id)
}
