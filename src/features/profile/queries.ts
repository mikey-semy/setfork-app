import 'server-only'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db, runs, stars, templates, users } from '@/shared/db'
import type { FeedItem } from '@/features/library/queries'
import { avatarSrc } from '@/shared/media'

export async function getUserByHandle(handle: string) {
  const [u] = await db.select().from(users).where(eq(users.handle, handle)).limit(1)
  return u ?? null
}

export async function getProfileCounts(userId: string) {
  const [[l], [s], [r]] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(templates).where(eq(templates.ownerId, userId)),
    db.select({ c: sql<number>`count(*)::int` }).from(stars).where(eq(stars.userId, userId)),
    db.select({ c: sql<number>`count(*)::int` }).from(runs).where(eq(runs.userId, userId)),
  ])
  return { lists: l?.c ?? 0, stars: s?.c ?? 0, runs: r?.c ?? 0 }
}

/** Списки, отмеченные звездой этим пользователем. */
export async function getStarredTemplates(userId: string): Promise<FeedItem[]> {
  const rows = await db
    .select({
      id: templates.id,
      ownerHandle: users.handle,
      ownerAvatarUrl: users.avatarUrl,
      slug: templates.slug,
      title: templates.title,
      desc: templates.desc,
      tags: templates.tags,
      version: templates.currentVersion,
      origin: templates.origin,
      runsCount: templates.runsCount,
      forksCount: templates.forksCount,
      starsCount: templates.starsCount,
      updatedAt: templates.updatedAt,
    })
    .from(stars)
    .innerJoin(templates, eq(stars.templateId, templates.id))
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(eq(stars.userId, userId))
    .orderBy(desc(stars.createdAt))
  return Promise.all(
    (rows as FeedItem[]).map(async (r) => ({ ...r, ownerAvatarUrl: await avatarSrc(r.ownerAvatarUrl, 96) })),
  )
}

/** Прогоны пользователя (для вкладки профиля). */
export async function getProfileRuns(userId: string) {
  return db
    .select({
      id: runs.id,
      status: runs.status,
      doneCount: runs.doneCount,
      version: runs.version,
      updatedAt: runs.updatedAt,
      ownerHandle: users.handle,
      slug: templates.slug,
      title: templates.title,
    })
    .from(runs)
    .innerJoin(templates, eq(runs.templateId, templates.id))
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(eq(runs.userId, userId))
    .orderBy(desc(runs.updatedAt))
}
