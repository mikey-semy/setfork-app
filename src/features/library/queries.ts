import 'server-only'
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { db, stars, templates, topics, users } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'

export type FeedSort = 'trending' | 'newest' | 'mostLiked'

export interface FeedItem {
  id: string
  ownerHandle: string
  ownerAvatarUrl: string | null
  slug: string
  title: LocaleText
  desc: LocaleText
  topicLabel: LocaleText | null
  topicColor: string | null
  version: number
  origin: 'authored' | 'forked' | 'ai_draft'
  runsCount: number
  forksCount: number
  starsCount: number
  updatedAt: Date
}

export interface TopicRow {
  slug: string
  label: LocaleText
  color: string
  count: number
}

export async function getTopics(): Promise<TopicRow[]> {
  const rows = await db
    .select({
      slug: topics.slug,
      label: topics.label,
      color: topics.color,
      count: sql<number>`count(${templates.id})::int`,
    })
    .from(topics)
    .leftJoin(templates, eq(templates.topicId, topics.id))
    .groupBy(topics.id)
    .orderBy(desc(sql`count(${templates.id})`))
  return rows
}

export async function getFeed(
  opts: { sort?: FeedSort; topicSlug?: string; q?: string } = {},
): Promise<FeedItem[]> {
  const order =
    opts.sort === 'newest'
      ? desc(templates.updatedAt)
      : opts.sort === 'mostLiked'
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
      topicLabel: topics.label,
      topicColor: topics.color,
      version: templates.currentVersion,
      origin: templates.origin,
      runsCount: templates.runsCount,
      forksCount: templates.forksCount,
      starsCount: templates.starsCount,
      updatedAt: templates.updatedAt,
    })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .leftJoin(topics, eq(templates.topicId, topics.id))

  const filters: SQL[] = []
  if (opts.topicSlug) filters.push(eq(topics.slug, opts.topicSlug))
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
  return rows as FeedItem[]
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
      topicLabel: topics.label,
      topicColor: topics.color,
      version: templates.currentVersion,
      origin: templates.origin,
      runsCount: templates.runsCount,
      forksCount: templates.forksCount,
      starsCount: templates.starsCount,
      updatedAt: templates.updatedAt,
    })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .leftJoin(topics, eq(templates.topicId, topics.id))
    .where(eq(templates.ownerId, userId))
    .orderBy(desc(templates.updatedAt))
  return rows as FeedItem[]
}

/** Лайкнул ли пользователь список. */
export async function isLiked(templateId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: stars.id })
    .from(stars)
    .where(and(eq(stars.userId, userId), eq(stars.templateId, templateId)))
    .limit(1)
  return !!row
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

  const currentVersion = tpl.versions.find((v) => v.version === tpl.currentVersion) ?? tpl.versions[0]
  const stepRows = currentVersion
    ? await db.query.steps.findMany({
        where: (s, { eq: e }) => e(s.versionId, currentVersion.id),
        orderBy: (s, { asc }) => asc(s.n),
      })
    : []

  return { tpl, currentVersion, steps: stepRows }
}
