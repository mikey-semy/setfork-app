import 'server-only'
import { cache } from 'react'
import { and, desc, eq, or, sql } from 'drizzle-orm'
import { courseCompletions, db, runs, stars, suggestions, templateVersions, templates, users } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
import type { FeedItem } from '@/features/library/queries'
import { avatarSrc } from '@/shared/media'

// cache() — дедуп в рамках одного запроса (generateMetadata + сама страница
// зовут его на профиле → один SQL вместо двух).
export const getUserByHandle = cache(async (handle: string) => {
  const [u] = await db.select().from(users).where(eq(users.handle, handle)).limit(1)
  return u ?? null
})

// ── Лента активности (Contribution activity, как GitHub) ─────────────
export interface MonthActivity {
  versions: { slug: string; title: LocaleText; count: number }[] // версии по спискам (top-N)
  versionsTotal: number
  listsCreated: { slug: string; title: LocaleText }[]
  issuesOpened: number
  issuesLists: number
  suggestionsCreated: number
}

/** Агрегаты активности пользователя за месяц [from, to) — по типам работ. */
export async function getMonthActivity(userId: string, from: Date, to: Date, viewerId?: string): Promise<MonthActivity> {
  // Секции versions/listsCreated отдают slug'и списков владельца. Публично видимые
  // (public+published+active) видит любой; черновики/приватные/снятые — только сам
  // владелец. Иначе аноним узнавал существование и slug чужого черновика по его версиям
  // (та же утечка, что #193 закрыл в ленте/дайджесте/Starred, но профильную активность минула).
  const vid = viewerId ?? null
  const visV = sql`and (t.visibility = 'public' and t.status = 'published' and t.moderation = 'active' or t.owner_id = ${vid})`
  const visC = sql`and (visibility = 'public' and status = 'published' and moderation = 'active' or owner_id = ${vid})`
  const [verRows, created, issuesAgg, suggAgg] = await Promise.all([
    db.execute(sql`
      select t.slug, t.title, count(*)::int as count
      from template_versions tv join templates t on t.id = tv.template_id
      where t.owner_id = ${userId} and tv.created_at >= ${from} and tv.created_at < ${to} ${visV}
      group by t.slug, t.title order by count desc, t.slug asc`),
    db.execute(sql`
      select slug, title from templates
      where owner_id = ${userId} and created_at >= ${from} and created_at < ${to} ${visC}
      order by created_at desc limit 10`),
    db.execute(sql`
      select count(*)::int as n, count(distinct template_id)::int as lists
      from issues where author_id = ${userId} and created_at >= ${from} and created_at < ${to}`),
    db.execute(sql`
      select count(*)::int as n from suggestions
      where author_id = ${userId} and created_at >= ${from} and created_at < ${to}`),
  ])
  const versions = (verRows.rows as { slug: string; title: LocaleText; count: number }[]) ?? []
  const ia = (issuesAgg.rows[0] ?? { n: 0, lists: 0 }) as { n: number; lists: number }
  return {
    versions: versions.slice(0, 5),
    versionsTotal: versions.reduce((s, v) => s + Number(v.count), 0),
    listsCreated: (created.rows as { slug: string; title: LocaleText }[]) ?? [],
    issuesOpened: Number(ia.n),
    issuesLists: Number(ia.lists),
    suggestionsCreated: Number((suggAgg.rows[0] as { n: number } | undefined)?.n ?? 0),
  }
}

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
// Вклад по дням: без year — скользящее окно ~год (дефолтный граф);
// с year — весь календарный год (для выбора года, как GitHub).
export async function getContributions(userId: string, year?: number): Promise<{ date: string; count: number }[]> {
  const range =
    year != null
      ? sql`day >= ${`${year}-01-01`}::date and day < ${`${year + 1}-01-01`}::date`
      : sql`day >= now() - interval '371 days'`
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
    where ${range}
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

export interface CompletedCourse {
  templateId: string
  title: LocaleText
  slug: string
  ownerHandle: string
  version: number
  completedAt: Date
}

/** Курсы, пройденные пользователем (для секции профиля). Только публично видимые
 *  списки — приватные/черновики/скрытые не светим на публичном профиле. */
export async function getUserCompletions(userId: string): Promise<CompletedCourse[]> {
  return db
    .select({
      templateId: courseCompletions.templateId,
      title: templates.title,
      slug: templates.slug,
      ownerHandle: users.handle,
      version: courseCompletions.version,
      completedAt: courseCompletions.completedAt,
    })
    .from(courseCompletions)
    .innerJoin(templates, eq(templates.id, courseCompletions.templateId))
    .innerJoin(users, eq(users.id, templates.ownerId))
    .where(
      and(
        eq(courseCompletions.userId, userId),
        eq(templates.visibility, 'public'),
        eq(templates.status, 'published'),
        eq(templates.moderation, 'active'),
      ),
    )
    .orderBy(desc(courseCompletions.completedAt))
    .limit(24)
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
  // Публично видимый = public + published + active. Раньше фильтр смотрел только на
  // visibility → в публичной вкладке «Starred» светились ставшие flagged/hidden списки
  // и чужие публичные черновики. Свои (owner) видны в любом статусе.
  const publicVisible = and(
    eq(templates.visibility, 'public'),
    eq(templates.status, 'published'),
    eq(templates.moderation, 'active'),
  )!
  const visible = viewerId ? or(publicVisible, eq(templates.ownerId, viewerId))! : publicVisible
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
