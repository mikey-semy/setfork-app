import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { db, follows } from '@/shared/db'

export async function isFollowing(followerId: string, followingId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: follows.id })
    .from(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)))
    .limit(1)
  return !!row
}

export async function getFollowCounts(userId: string): Promise<{ followers: number; following: number }> {
  const [[f], [g]] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followingId, userId)),
    db.select({ c: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followerId, userId)),
  ])
  return { followers: f?.c ?? 0, following: g?.c ?? 0 }
}

/** ID пользователей, на которых подписан userId (для ленты активности). */
export async function getFollowingIds(userId: string): Promise<string[]> {
  const rows = await db.select({ id: follows.followingId }).from(follows).where(eq(follows.followerId, userId))
  return rows.map((r) => r.id)
}
