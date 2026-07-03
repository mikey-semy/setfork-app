import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import type { CurationStore } from '@/core'
import { db, stars, templates, watches } from '@/shared/db'

// Каноническая реализация порта CurationStore (звёзды/watch). Пост-MVP → Rust за тем же портом.
// Побочные эффекты уровня delivery (notify/revalidate) делают вызывающие server-actions.
export const curationStore: CurationStore = {
  async isStarred(listId, userId) {
    const [r] = await db
      .select({ id: stars.id })
      .from(stars)
      .where(and(eq(stars.templateId, listId), eq(stars.userId, userId)))
      .limit(1)
    return !!r
  },

  async toggleStar(listId, userId) {
    const [ex] = await db
      .select({ id: stars.id })
      .from(stars)
      .where(and(eq(stars.userId, userId), eq(stars.templateId, listId)))
      .limit(1)
    if (ex) {
      await db.delete(stars).where(and(eq(stars.userId, userId), eq(stars.templateId, listId)))
      await db.update(templates).set({ starsCount: sql`GREATEST(${templates.starsCount} - 1, 0)` }).where(eq(templates.id, listId))
      return false
    }
    await db.insert(stars).values({ userId, templateId: listId }).onConflictDoNothing()
    await db.update(templates).set({ starsCount: sql`${templates.starsCount} + 1` }).where(eq(templates.id, listId))
    return true
  },

  async isWatching(listId, userId) {
    const [r] = await db
      .select({ id: watches.id })
      .from(watches)
      .where(and(eq(watches.userId, userId), eq(watches.templateId, listId)))
      .limit(1)
    return !!r
  },

  async toggleWatch(listId, userId) {
    const [ex] = await db
      .select({ id: watches.id })
      .from(watches)
      .where(and(eq(watches.userId, userId), eq(watches.templateId, listId)))
      .limit(1)
    if (ex) {
      await db.delete(watches).where(and(eq(watches.userId, userId), eq(watches.templateId, listId)))
      return false
    }
    await db.insert(watches).values({ userId, templateId: listId }).onConflictDoNothing()
    return true
  },

  async ensureWatch(listId, userId) {
    try {
      await db.insert(watches).values({ userId, templateId: listId }).onConflictDoNothing()
    } catch {
      /* watch — не критичный путь */
    }
  },

  async watchCount(listId) {
    const [r] = await db.select({ c: sql<number>`count(*)::int` }).from(watches).where(eq(watches.templateId, listId))
    return r?.c ?? 0
  },

  async watcherIds(listId) {
    const rows = await db.select({ id: watches.userId }).from(watches).where(eq(watches.templateId, listId))
    return rows.map((r) => r.id)
  },
}
