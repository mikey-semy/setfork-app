import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
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

/** ID списков, за которыми следит пользователь (для ленты дашборда). Не в порту CurationStore.
 *  Только активные уровни (all/custom); 'ignore' исключаем — иначе игнорируемый список
 *  продолжал бы сыпать активность в домашнюю ленту (Codex P2 на #392). */
export async function getWatchedIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: watches.templateId })
    .from(watches)
    .where(and(eq(watches.userId, userId), sql`${watches.level} in ('all','custom')`))
  return rows.map((r) => r.id)
}
