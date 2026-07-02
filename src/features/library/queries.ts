import 'server-only'
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import { db, stars, suggestions, templates, templateVersions, users } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
import { avatarSrc } from '@/shared/media'

// Резолвим ownerAvatarUrl (storage_key → подписанный imgproxy-URL) для ленты.
async function withAvatar<T extends { ownerAvatarUrl: string | null }>(rows: T[]): Promise<T[]> {
  return Promise.all(rows.map(async (r) => ({ ...r, ownerAvatarUrl: await avatarSrc(r.ownerAvatarUrl, 96) })))
}

export type FeedSort = 'trending' | 'newest' | 'mostStarred'

export interface FeedItem {
  id: string
  ownerHandle: string
  ownerAvatarUrl: string | null
  slug: string
  title: LocaleText
  desc: LocaleText
  tags: string[]
  version: number
  origin: 'authored' | 'forked' | 'ai_draft'
  runsCount: number
  forksCount: number
  starsCount: number
  updatedAt: Date
}

export interface TagRow {
  tag: string
  count: number
}

/** Популярные теги с counts (как GitHub topics). */
export async function getPopularTags(limit = 24): Promise<TagRow[]> {
  const res = await db.execute(sql`
    select unnest(${templates.tags}) as tag, count(*)::int as count
    from ${templates}
    group by 1
    order by count desc, tag asc
    limit ${limit}
  `)
  return res.rows as unknown as TagRow[]
}

export async function getFeed(
  opts: { sort?: FeedSort; tag?: string; q?: string } = {},
): Promise<FeedItem[]> {
  const order =
    opts.sort === 'newest'
      ? desc(templates.updatedAt)
      : opts.sort === 'mostStarred'
        ? desc(templates.starsCount)
        : desc(sql`${templates.starsCount} + ${templates.forksCount}`) // trending

  const base = db
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
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))

  const filters: SQL[] = []
  if (opts.tag) filters.push(sql`${templates.tags} @> ARRAY[${opts.tag}]::text[]`)
  if (opts.q?.trim()) {
    const like = `%${opts.q.trim()}%`
    // Поиск по всем языкам сразу: jsonb → text.
    filters.push(
      or(
        ilike(sql`${templates.title}::text`, like),
        ilike(sql`${templates.desc}::text`, like),
        ilike(templates.slug, like),
      )!,
    )
  }

  const rows = filters.length
    ? await base.where(and(...filters)).orderBy(order)
    : await base.orderBy(order)
  return withAvatar(rows as FeedItem[])
}

/** Списки, созданные или форкнутые пользователем (страница /my-lists). */
export async function getUserTemplates(userId: string): Promise<FeedItem[]> {
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
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(eq(templates.ownerId, userId))
    .orderBy(desc(templates.updatedAt))
  return withAvatar(rows as FeedItem[])
}

export interface ActivityItem {
  templateId: string
  ownerHandle: string
  ownerAvatarUrl: string | null
  slug: string
  title: LocaleText
  version: number
  note: string
  origin: 'authored' | 'forked' | 'ai_draft'
  createdAt: Date
}

/** Лента изменений: недавние версии (создание/правки) списков. */
export async function getActivity(limit = 30): Promise<ActivityItem[]> {
  const rows = await db
    .select({
      templateId: templates.id,
      ownerHandle: users.handle,
      ownerAvatarUrl: users.avatarUrl,
      slug: templates.slug,
      title: templates.title,
      version: templateVersions.version,
      note: templateVersions.note,
      origin: templates.origin,
      createdAt: templateVersions.createdAt,
    })
    .from(templateVersions)
    .innerJoin(templates, eq(templateVersions.templateId, templates.id))
    .innerJoin(users, eq(templates.ownerId, users.id))
    .orderBy(desc(templateVersions.createdAt))
    .limit(limit)
  return withAvatar(rows as ActivityItem[])
}

/** Предложения правок для списка (с авторами). */
export async function getSuggestions(templateId: string) {
  const rows = await db.query.suggestions.findMany({
    where: (s) => eq(s.templateId, templateId),
    with: { author: true },
    orderBy: (s, { asc, desc: d }) => [asc(s.status), d(s.createdAt)],
  })
  return Promise.all(
    rows.map(async (r) => ({ ...r, author: { ...r.author, avatarUrl: await avatarSrc(r.author.avatarUrl, 64) } })),
  )
}

/** Число открытых предложений. */
export async function getOpenSuggestionCount(templateId: string): Promise<number> {
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(suggestions)
    .where(and(eq(suggestions.templateId, templateId), eq(suggestions.status, 'open')))
  return r?.c ?? 0
}

/** Отметил ли пользователь список звездой. */
export async function isStarred(templateId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: stars.id })
    .from(stars)
    .where(and(eq(stars.userId, userId), eq(stars.templateId, templateId)))
    .limit(1)
  return !!row
}

/** ID списков, отмеченных звездой пользователем (для карточек ленты). */
export async function getStarredIds(userId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = await db
    .select({ t: stars.templateId })
    .from(stars)
    .where(and(eq(stars.userId, userId), inArray(stars.templateId, ids)))
  return new Set(rows.map((r) => r.t))
}

/** Лёгкая мета списка для шапки/сайдбара (без шагов). */
export async function getListMeta(ownerHandle: string, slug: string) {
  const [row] = await db
    .select({
      id: templates.id,
      ownerId: templates.ownerId,
      ownerHandle: users.handle,
      ownerName: users.name,
      ownerAvatarUrl: users.avatarUrl,
      slug: templates.slug,
      title: templates.title,
      desc: templates.desc,
      tags: templates.tags,
      currentVersion: templates.currentVersion,
      origin: templates.origin,
      starsCount: templates.starsCount,
      forksCount: templates.forksCount,
      createdAt: templates.createdAt,
      updatedAt: templates.updatedAt,
    })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(users.handle, ownerHandle), eq(templates.slug, slug)))
    .limit(1)
  if (!row) return null
  return { ...row, ownerAvatarUrl: await avatarSrc(row.ownerAvatarUrl, 96) }
}

/** Версии списка (для вкладки «Версии»). */
export async function getVersions(templateId: string) {
  return db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(desc(templateVersions.version))
}

/** Детальный список (owner/slug) + пункты текущей версии. */
export async function getTemplateDetail(ownerHandle: string, slug: string) {
  const owner = await db.select().from(users).where(eq(users.handle, ownerHandle)).limit(1)
  if (!owner[0]) return null

  const tpl = await db.query.templates.findFirst({
    where: (tt, { and, eq: e }) => and(e(tt.ownerId, owner[0].id), e(tt.slug, slug)),
    with: {
      owner: true,
      topic: true,
      versions: { orderBy: (v, { desc: d }) => d(v.version) },
    },
  })
  if (!tpl) return null

  tpl.owner.avatarUrl = await avatarSrc(tpl.owner.avatarUrl, 96)
  const currentVersion = tpl.versions.find((v) => v.version === tpl.currentVersion) ?? tpl.versions[0]
  const stepRows = currentVersion
    ? await db.query.steps.findMany({
        where: (s, { eq: e }) => e(s.versionId, currentVersion.id),
        orderBy: (s, { asc }) => asc(s.n),
      })
    : []

  return { tpl, currentVersion, steps: stepRows }
}
