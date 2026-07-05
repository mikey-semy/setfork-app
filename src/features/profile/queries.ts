import 'server-only'
import { cache } from 'react'
import { and, desc, eq, or, sql } from 'drizzle-orm'
import { db, runs, stars, suggestions, templateVersions, templates, users } from '@/shared/db'
import type { FeedItem } from '@/features/library/queries'
import { avatarSrc } from '@/shared/media'

// cache() — дедуп в рамках одного запроса (generateMetadata + сама страница
// зовут его на профиле → один SQL вместо двух).
export const getUserByHandle = cache(async (handle: string) => {
  const [u] = await db.select().from(users).where(eq(users.handle, handle)).limit(1)
  return u ?? null
})

/** Лёгкий список своих списков для пикера пинов («Customize your pins»). */
export async function getOwnListsLight(userId: string): Promise<{ id: string; slug: string; pinned: boolean }[]> {
  return db
    .select({ id: templates.id, slug: templates.slug, pinned: templates.pinned })
    .from(templates)
    .where(eq(templates.ownerId, userId))
    .orderBy(desc(templates.pinned), desc(templates.updatedAt))
    .limit(100)
}

/** Активность по дням за ~год: версии списков (правки) + предложения правок. */
export async function getContributions(userId: string): Promise<{ date: string; count: number }[]> {
  const res = await db.execute(sql`
    select (day::date)::text as date, count(*)::int as count
    from (
      select tv.created_at as day
        from ${templateVersions} tv
        join ${templates} t on t.id = tv.template_id
        where t.owner_id = ${userId}
      union all
      select s.created_at from ${suggestions} s where s.author_id = ${userId}
    ) x
    where day >= now() - interval '371 days'
    group by 1
  `)
  return res.rows as unknown as { date: string; count: number }[]
}

/** Полученные звёзды и форки на списках пользователя. */
export async function getReceivedStats(userId: string): Promise<{ stars: number; forks: number }> {
  const [r] = await db
    .select({
      stars: sql<number>`coalesce(sum(${templates.starsCount}),0)::int`,
      forks: sql<number>`coalesce(sum(${templates.forksCount}),0)::int`,
    })
    .from(templates)
    .where(eq(templates.ownerId, userId))
  return { stars: r?.stars ?? 0, forks: r?.forks ?? 0 }
}

export async function getProfileCounts(userId: string) {
  const [[l], [s], [r]] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(templates).where(eq(templates.ownerId, userId)),
    db.select({ c: sql<number>`count(*)::int` }).from(stars).where(eq(stars.userId, userId)),
    db.select({ c: sql<number>`count(*)::int` }).from(runs).where(eq(runs.userId, userId)),
  ])
  return { lists: l?.c ?? 0, stars: s?.c ?? 0, runs: r?.c ?? 0 }
}

/** Списки, отмеченные звездой пользователем. viewerId скрывает чужие приватные. */
export async function getStarredTemplates(userId: string, viewerId?: string): Promise<FeedItem[]> {
  const visible = viewerId
    ? or(eq(templates.visibility, 'public'), eq(templates.ownerId, viewerId))!
    : eq(templates.visibility, 'public')
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
      visibility: templates.visibility,
      verified: templates.verified,
      updatedAt: templates.updatedAt,
    })
    .from(stars)
    .innerJoin(templates, eq(stars.templateId, templates.id))
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(stars.userId, userId), visible))
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
