import 'server-only'
import { desc, eq, sql } from 'drizzle-orm'
import { db, feedItems, feedSources } from '@/shared/db'

/** Подписка на поток так, как её видит владелец: настройки + что она реально принесла. */
export interface FeedSourceRow {
  id: string
  url: string
  title: string
  tags: string[]
  everyHours: number
  enabled: boolean
  lastPulledAt: Date | null
  lastError: string
  lastItems: number
  /** Всего элементов от этой подписки и сколько из них ещё никуда не пошло. */
  items: number
  fresh: number
}

/**
 * Список подписок с итогами. Числа считает БД одним запросом: по подписке на источник
 * страница делала бы N+1, а источников со временем станут десятки.
 */
export async function feedSourceRows(): Promise<FeedSourceRow[]> {
  const rows = await db
    .select({
      id: feedSources.id,
      url: feedSources.url,
      title: feedSources.title,
      tags: feedSources.tags,
      everyHours: feedSources.everyHours,
      enabled: feedSources.enabled,
      lastPulledAt: feedSources.lastPulledAt,
      lastError: feedSources.lastError,
      lastItems: feedSources.lastItems,
      items: sql<number>`(count(${feedItems.id}))::int`,
      // filter (where …) вместо count по подзапросу: та же строка, один проход.
      fresh: sql<number>`(count(${feedItems.id}) filter (where ${feedItems.usedAt} is null))::int`,
    })
    .from(feedSources)
    .leftJoin(feedItems, eq(feedItems.sourceId, feedSources.id))
    .groupBy(feedSources.id)
    .orderBy(desc(feedSources.createdAt))
  return rows
}

/** Последние пришедшие материалы — чтобы владелец видел, что поток живой, а не «настроен». */
export async function recentFeedItems(limit = 12) {
  return db
    .select({
      id: feedItems.id,
      title: feedItems.title,
      url: feedItems.url,
      tags: feedItems.tags,
      publishedAt: feedItems.publishedAt,
      createdAt: feedItems.createdAt,
      usedAt: feedItems.usedAt,
      usedTemplateId: feedItems.usedTemplateId,
    })
    .from(feedItems)
    .orderBy(desc(feedItems.createdAt))
    .limit(limit)
}
