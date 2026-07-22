import 'server-only'
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { db, follows, templates, users } from '@/shared/db'
import { avatarSrc } from '@/shared/media'

export type PeopleSort = 'followers' | 'lists' | 'newest'

export interface PersonRow {
  handle: string
  name: string | null
  avatarUrl: string | null
  bio: string | null
  listsCount: number
  followersCount: number
}

// Публичные списки этого пользователя (для счётчика на карточке).
const listsCountExpr = sql<number>`(
  select count(*)::int from ${templates}
  where ${templates.ownerId} = ${users.id}
    and ${templates.status} = 'published' and ${templates.visibility} = 'public' and ${templates.moderation} = 'active'
)`
const followersCountExpr = sql<number>`(select count(*)::int from ${follows} where ${follows.followingId} = ${users.id})`

function peopleWhere(q?: string): SQL {
  // Приватные профили не всплывают в поиске людей (скрыты от всех кроме владельца).
  const base = and(eq(users.deleted, false), eq(users.profilePrivate, false))!
  if (!q) return base
  const like = `%${q}%`
  return and(base, or(ilike(users.handle, like), ilike(users.name, like)))!
}

/** Число людей под запрос (для бейджа scope-переключателя). */
export async function countPeople(q?: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(peopleWhere(q))
  return row?.n ?? 0
}

/** Глобальный публичный поиск людей (серверный — страница Explore рендерится на сервере). */
export async function searchPeople({
  q,
  sort = 'followers',
  limit = 30,
}: {
  q?: string
  sort?: PeopleSort
  limit?: number
}): Promise<PersonRow[]> {
  const order = sort === 'newest' ? desc(users.createdAt) : sort === 'lists' ? desc(listsCountExpr) : desc(followersCountExpr)
  const rows = await db
    .select({
      handle: users.handle,
      name: users.name,
      avatarUrl: users.avatarUrl,
      bio: users.bio,
      listsCount: listsCountExpr,
      followersCount: followersCountExpr,
    })
    .from(users)
    .where(peopleWhere(q))
    .orderBy(order, desc(users.createdAt))
    .limit(limit)
  return Promise.all(rows.map(async (r) => ({ ...r, avatarUrl: await avatarSrc(r.avatarUrl, 96) })))
}

const personCols = {
  handle: users.handle,
  name: users.name,
  avatarUrl: users.avatarUrl,
  bio: users.bio,
  listsCount: listsCountExpr,
  followersCount: followersCountExpr,
}

/** Кто подписан на userId (followers). */
export async function getFollowers(userId: string): Promise<PersonRow[]> {
  const rows = await db
    .select(personCols)
    .from(follows)
    .innerJoin(users, eq(users.id, follows.followerId))
    .where(and(eq(follows.followingId, userId), eq(users.deleted, false), eq(users.profilePrivate, false)))
    .orderBy(desc(follows.createdAt))
    .limit(200)
  return Promise.all(rows.map(async (r) => ({ ...r, avatarUrl: await avatarSrc(r.avatarUrl, 96) })))
}

/** На кого подписан userId (following). */
export async function getFollowing(userId: string): Promise<PersonRow[]> {
  const rows = await db
    .select(personCols)
    .from(follows)
    .innerJoin(users, eq(users.id, follows.followingId))
    .where(and(eq(follows.followerId, userId), eq(users.deleted, false), eq(users.profilePrivate, false)))
    .orderBy(desc(follows.createdAt))
    .limit(200)
  return Promise.all(rows.map(async (r) => ({ ...r, avatarUrl: await avatarSrc(r.avatarUrl, 96) })))
}
