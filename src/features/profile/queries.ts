import 'server-only'
import { cache } from 'react'
import { and, desc, eq, or, sql } from 'drizzle-orm'
import { courseCompletions, db, issues, runs, stars, suggestions, templateVersions, templates, users, publiclyVisible } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
import type { FeedItem } from '@/features/library/queries'
import { avatarSrc } from '@/shared/media'
import type { ActivityTopic } from './activity/types'

// cache() — дедуп в рамках одного запроса (generateMetadata + сама страница
// зовут его на профиле → один SQL вместо двух).
export const getUserByHandle = cache(async (handle: string) => {
  const [u] = await db.select().from(users).where(eq(users.handle, handle)).limit(1)
  return u ?? null
})

// ── Лента активности (Contribution activity, как GitHub) ─────────────

/** Сколько списков перечисляем внутри темы: дальше это стена ссылок, а не сводка. */
const TOP_LISTS = 5

/** Время последнего события темы в ISO; null — темы за окно не было. */
function at(row: { at?: string | Date | null } | undefined): string | null {
  const v = row?.at
  return v ? new Date(v).toISOString() : null
}

/**
 * Активность пользователя за окно [from, to) темами, новые сверху. Одно и то же
 * окно закрывает и месяц ленты, и один день (фильтр по клетке календаря).
 */
export async function getActivityTopics(userId: string, from: Date, to: Date, viewerId?: string): Promise<ActivityTopic[]> {
  // Темы отдают наружу slug'и и счётчики по спискам. Публично видимые
  // (public+published+active) видит любой; черновики/приватные/снятые — только сам
  // владелец. Иначе аноним узнавал существование и slug чужого черновика по его версиям
  // (та же утечка, что #193 закрыл в ленте/дайджесте/Starred, но профильную активность минула).
  const vid = viewerId ?? null
  const visV = sql`and (t.visibility = 'public' and t.status = 'published' and t.moderation = 'active' or t.owner_id = ${vid})`
  const visC = sql`and (visibility = 'public' and status = 'published' and moderation = 'active' or owner_id = ${vid})`
  const [verRows, created, issuesAgg, suggAgg] = await Promise.all([
    // Оконные счётчики (count(*) over ()) считаются ДО limit — сводка «в N списках»
    // остаётся честной, хотя перечисляем мы только топ.
    db.execute(sql`
      select t.slug, t.title, count(*)::int as count, max(tv.created_at) as at,
             max(max(tv.created_at)) over () as topic_at,
             (count(*) over ())::int as lists_total, (sum(count(*)) over ())::int as versions_total
      from template_versions tv join templates t on t.id = tv.template_id
      where t.owner_id = ${userId} and tv.created_at >= ${from} and tv.created_at < ${to} ${visV}
      group by t.slug, t.title order by count desc, t.slug asc limit ${TOP_LISTS}`),
    db.execute(sql`
      select slug, title, created_at as at, (count(*) over ())::int as total from templates
      where owner_id = ${userId} and created_at >= ${from} and created_at < ${to} ${visC}
      order by created_at desc limit ${TOP_LISTS}`),
    // Задачи и правки к ЧУЖИМ спискам гейтим тем же правилом: счётчик активности не
    // должен подтверждать существование приватного списка, в котором человек работал.
    db.execute(sql`
      select count(*)::int as n, count(distinct i.template_id)::int as lists, max(i.created_at) as at
      from issues i join templates t on t.id = i.template_id
      where i.author_id = ${userId} and i.created_at >= ${from} and i.created_at < ${to} ${visV}`),
    db.execute(sql`
      select count(*)::int as n, max(s.created_at) as at
      from suggestions s join templates t on t.id = s.template_id
      where s.author_id = ${userId} and s.created_at >= ${from} and s.created_at < ${to} ${visV}`),
  ])

  const versions = (verRows.rows ?? []) as { slug: string; title: LocaleText; count: number; at: string; topic_at: string; lists_total: number; versions_total: number }[]
  const lists = (created.rows ?? []) as { slug: string; title: LocaleText; at: string; total: number }[]
  const issues = issuesAgg.rows[0] as { n: number; lists: number; at: string | null } | undefined
  const suggs = suggAgg.rows[0] as { n: number; at: string | null } | undefined

  const topics: ActivityTopic[] = []
  // Время темы берём оконным максимумом: перечисляем мы топ по числу версий, а
  // самая поздняя правка легко может оказаться в списке, который в топ не попал.
  const versionsAt = versions[0] ? at({ at: versions[0].topic_at }) : null
  if (versionsAt) {
    topics.push({
      kind: 'versions',
      at: versionsAt,
      total: Number(versions[0].versions_total),
      listsTotal: Number(versions[0].lists_total),
      lists: versions.map((v) => ({ slug: v.slug, title: v.title, count: Number(v.count) })),
    })
  }
  const listsAt = at(lists[0])
  if (listsAt) {
    topics.push({ kind: 'lists', at: listsAt, total: Number(lists[0].total), lists: lists.map((l) => ({ slug: l.slug, title: l.title })) })
  }
  const issuesAt = at(issues)
  if (issuesAt && Number(issues?.n) > 0) {
    topics.push({ kind: 'issues', at: issuesAt, total: Number(issues!.n), listsTotal: Number(issues!.lists) })
  }
  const suggsAt = at(suggs)
  if (suggsAt && Number(suggs?.n) > 0) {
    topics.push({ kind: 'suggestions', at: suggsAt, total: Number(suggs!.n) })
  }
  return topics.sort((a, b) => b.at.localeCompare(a.at))
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

/** Активность по дням за ~год: версии списков, задачи и предложения правок. */
// Вклад по дням: без year — скользящее окно ~год (дефолтный граф);
// с year — весь календарный год (для выбора года, как GitHub).
export async function getContributions(userId: string, year?: number, viewerId?: string): Promise<{ date: string; count: number }[]> {
  const range =
    year != null
      ? sql`day >= ${`${year}-01-01`}::date and day < ${`${year + 1}-01-01`}::date`
      : sql`day >= now() - interval '371 days'`
  // Версии приватных/черновиков/снятых списков светились в графе-квадратиках ВСЕМ —
  // чужой видел «в этот день была активность» по недоступному ему списку. Гейтим по
  // видимости с учётом зрителя (владелец видит всё), как getActivityTopics.
  const vis = sql`and (t.visibility = 'public' and t.status = 'published' and t.moderation = 'active' or t.owner_id = ${viewerId ?? null})`
  // Клетка календаря — это фильтр ленты, поэтому считает ровно те же события, что
  // лента показывает: версии, задачи, предложения. Создание списка (как заведение
  // репозитория у GitHub) в клетку не идёт — оно только в ленте.
  const res = await db.execute(sql`
    select (day::date)::text as date, count(*)::int as count
    from (
      select tv.created_at as day
        from ${templateVersions} tv
        join ${templates} t on t.id = tv.template_id
        where t.owner_id = ${userId} ${vis}
      union all
      select s.created_at
        from ${suggestions} s
        join ${templates} t on t.id = s.template_id
        where s.author_id = ${userId} ${vis}
      union all
      select i.created_at
        from ${issues} i
        join ${templates} t on t.id = i.template_id
        where i.author_id = ${userId} ${vis}
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
  /** NULL, если курс с тех пор удалили: достижение остаётся, ссылка на него — нет. */
  templateId: string | null
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
        publiclyVisible(),
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
    publiclyVisible(),
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
