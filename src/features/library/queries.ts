import 'server-only'
import { and, cosineDistance, desc, eq, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm'
import { db, embeddings, stars, suggestions, templates, templateVersions, users } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
import { avatarSrc, imageUrl } from '@/shared/media'
import { getSearchSettings } from '@/shared/settings/search'

/** Резолвит скриншоты шагов: imageKey → подписанный URL. Для префилла редактора и показа. */
export async function getStepPreviews(
  steps: { imageKey: string | null }[],
  options = 'rs:fit:960:960',
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    steps
      .filter((s) => s.imageKey)
      .map(async (s) => [s.imageKey as string, await imageUrl(s.imageKey, options)] as const),
  )
  return Object.fromEntries(entries.filter(([, u]) => u)) as Record<string, string>
}

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
  visibility: 'public' | 'private'
  verified: boolean
  updatedAt: Date
}

export interface TagRow {
  tag: string
  count: number
}

/** Популярные теги с counts (как GitHub topics). Только по публичным спискам. */
export async function getPopularTags(limit = 24): Promise<TagRow[]> {
  const res = await db.execute(sql`
    select unnest(${templates.tags}) as tag, count(*)::int as count
    from ${templates}
    where ${templates.visibility} = 'public' and ${templates.moderation} = 'active'
    group by 1
    order by count desc, tag asc
    limit ${limit}
  `)
  return res.rows as unknown as TagRow[]
}

// Колонки FeedItem — общие для ленты и поиска.
const FEED_COLS = {
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
}

const tagFilter = (tag: string): SQL => sql`${templates.tags} @> ARRAY[${tag}]::text[]`

// В публичном доступе — только public + moderation='active' (flagged/hidden не публикуются).
// Владелец видит свои списки в любом статусе.
function visibleFilter(viewerId?: string): SQL {
  const publicVisible = and(eq(templates.visibility, 'public'), eq(templates.moderation, 'active'))!
  return viewerId ? or(publicVisible, eq(templates.ownerId, viewerId))! : publicVisible
}

/** Поиск/лента по ключевым словам (ILIKE по всем языкам сразу). q пустой = просто лента. */
async function keywordFeed(order: SQL, viewerId?: string, tag?: string, q?: string): Promise<FeedItem[]> {
  const filters: SQL[] = [visibleFilter(viewerId)]
  if (tag) filters.push(tagFilter(tag))
  if (q) {
    const like = `%${q}%`
    filters.push(or(ilike(sql`${templates.title}::text`, like), ilike(sql`${templates.desc}::text`, like), ilike(templates.slug, like))!)
  }
  const rows = await db
    .select(FEED_COLS)
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(...filters))
    .orderBy(order)
  return rows as FeedItem[]
}

/** Семантический поиск (pgvector cosine) с порогом схожести. null, если запрос нельзя векторизовать. */
async function semanticFeed(
  q: string,
  tag: string | undefined,
  limit: number,
  minScore: number,
  viewerId?: string,
): Promise<FeedItem[] | null> {
  const { getAiSettings } = await import('@/shared/settings/ai')
  const { embedOne } = await import('@/shared/ai/embeddings')
  const { embeddingModel } = await getAiSettings()
  const vec = await embedOne(q, embeddingModel)
  if (!vec) return null

  const distance = cosineDistance(embeddings.embedding, vec)
  const similarity = sql<number>`1 - (${distance})`
  const filters: SQL[] = [eq(embeddings.kind, 'list'), isNotNull(embeddings.embedding), visibleFilter(viewerId)]
  // Порог: similarity >= minScore  ⇔  distance <= 1 - minScore.
  if (minScore > 0) filters.push(sql`${distance} <= ${1 - minScore}`)
  if (tag) filters.push(tagFilter(tag))
  const rows = await db
    .select(FEED_COLS)
    .from(embeddings)
    .innerJoin(templates, eq(embeddings.refId, templates.id))
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(...filters))
    .orderBy(desc(similarity))
    .limit(limit)
  return rows as FeedItem[]
}

export async function getFeed(
  opts: { sort?: FeedSort; tag?: string; q?: string } = {},
  viewerId?: string,
): Promise<FeedItem[]> {
  const order =
    opts.sort === 'newest'
      ? desc(templates.updatedAt)
      : opts.sort === 'mostStarred'
        ? desc(templates.starsCount)
        : desc(sql`${templates.starsCount} + ${templates.forksCount}`) // trending

  const q = opts.q?.trim()
  if (!q) return withAvatar(await keywordFeed(order, viewerId, opts.tag))

  const { mode, minScore, limit } = await getSearchSettings()
  if (mode === 'keyword') return withAvatar(await keywordFeed(order, viewerId, opts.tag, q))

  const semantic = await semanticFeed(q, opts.tag, limit, minScore, viewerId)
  // Нет вектора (нет ключа/эмбеддингов) → откат на ключевые слова.
  if (!semantic) return withAvatar(await keywordFeed(order, viewerId, opts.tag, q))
  if (mode === 'semantic') return withAvatar(semantic)

  // hybrid: сначала по смыслу, затем добираем совпадения по словам, которых ещё нет.
  const keyword = await keywordFeed(order, viewerId, opts.tag, q)
  const seen = new Set(semantic.map((r) => r.id))
  return withAvatar([...semantic, ...keyword.filter((r) => !seen.has(r.id))])
}

/** Списки пользователя. viewerId = кто смотрит: владелец видит и приватные. */
export async function getUserTemplates(userId: string, viewerId?: string): Promise<FeedItem[]> {
  const rows = await db
    .select(FEED_COLS)
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(templates.ownerId, userId), visibleFilter(viewerId)))
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
export async function getActivity(limit = 30, viewerId?: string): Promise<ActivityItem[]> {
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
    .where(visibleFilter(viewerId))
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
      visibility: templates.visibility,
      moderation: templates.moderation,
      moderationReason: templates.moderationReason,
      verified: templates.verified,
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
