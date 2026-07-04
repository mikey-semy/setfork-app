import 'server-only'
import { and, asc, cosineDistance, desc, eq, gte, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm'
import { db, embeddings, stars, steps, suggestionComments, suggestions, templates, templateVersions, users } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
import { avatarSrc, imageUrl } from '@/shared/media'
import { getSearchSettings } from '@/shared/settings/search'
import { curationStore } from '@/features/curation/adapter'

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
  status: 'draft' | 'published'
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
    where ${templates.status} = 'published' and ${templates.visibility} = 'public' and ${templates.moderation} = 'active'
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
  status: templates.status,
  runsCount: templates.runsCount,
  forksCount: templates.forksCount,
  starsCount: templates.starsCount,
  visibility: templates.visibility,
  verified: templates.verified,
  updatedAt: templates.updatedAt,
}

const tagFilter = (tag: string): SQL => sql`${templates.tags} @> ARRAY[${tag}]::text[]`

// В публичном доступе — только published + public + moderation='active'
// (черновики/flagged/hidden не публикуются). Владелец видит свои списки в любом статусе.
function visibleFilter(viewerId?: string): SQL {
  const publicVisible = and(
    eq(templates.status, 'published'),
    eq(templates.visibility, 'public'),
    eq(templates.moderation, 'active'),
  )!
  return viewerId ? or(publicVisible, eq(templates.ownerId, viewerId))! : publicVisible
}

/** Доп. фильтры ленты: verified, тип, автор (by), теги (AND), минимум звёзд. */
function extraFilters(opts: {
  verified?: boolean
  ordered?: boolean
  by?: string
  tags?: string[]
  minStars?: number
}): SQL[] {
  const f: SQL[] = []
  if (opts.verified) f.push(eq(templates.verified, true))
  if (opts.ordered !== undefined) f.push(eq(templates.ordered, opts.ordered))
  if (opts.by) f.push(eq(users.handle, opts.by)) // users приджойнен в обоих режимах
  if (opts.minStars != null) f.push(gte(templates.starsCount, opts.minStars))
  for (const tag of opts.tags ?? []) f.push(tagFilter(tag))
  return f
}

/** Поиск/лента по ключевым словам (ILIKE по всем языкам сразу). q пустой = просто лента. */
async function keywordFeed(order: SQL, viewerId?: string, tag?: string, q?: string, extra: SQL[] = []): Promise<FeedItem[]> {
  const filters: SQL[] = [visibleFilter(viewerId), ...extra]
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
  extra: SQL[] = [],
): Promise<FeedItem[] | null> {
  const { getAiSettings } = await import('@/shared/settings/ai')
  const { embedOne } = await import('@/shared/ai/embeddings')
  const { embeddingModel } = await getAiSettings()
  const vec = await embedOne(q, embeddingModel)
  if (!vec) return null

  const distance = cosineDistance(embeddings.embedding, vec)
  const similarity = sql<number>`1 - (${distance})`
  const filters: SQL[] = [eq(embeddings.kind, 'list'), isNotNull(embeddings.embedding), visibleFilter(viewerId), ...extra]
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
  opts: {
    sort?: FeedSort
    tag?: string
    q?: string
    verified?: boolean
    ordered?: boolean
    by?: string
    tags?: string[]
    minStars?: number
  } = {},
  viewerId?: string,
): Promise<FeedItem[]> {
  const order =
    opts.sort === 'newest'
      ? desc(templates.updatedAt)
      : opts.sort === 'mostStarred'
        ? desc(templates.starsCount)
        : desc(sql`${templates.starsCount} + ${templates.forksCount}`) // trending

  const extra = extraFilters(opts)
  const q = opts.q?.trim()
  if (!q) return withAvatar(await keywordFeed(order, viewerId, opts.tag, undefined, extra))

  const { mode, minScore, limit } = await getSearchSettings()
  if (mode === 'keyword') return withAvatar(await keywordFeed(order, viewerId, opts.tag, q, extra))

  const semantic = await semanticFeed(q, opts.tag, limit, minScore, viewerId, extra)
  // Нет вектора (нет ключа/эмбеддингов) → откат на ключевые слова.
  if (!semantic) return withAvatar(await keywordFeed(order, viewerId, opts.tag, q, extra))
  if (mode === 'semantic') return withAvatar(semantic)

  // hybrid: сначала ТОЧНЫЕ совпадения по словам (буквальное «ubuntu» точнее),
  // затем добираем по смыслу — чтобы семантически-похожее не всплывало над точным.
  const keyword = await keywordFeed(order, viewerId, opts.tag, q, extra)
  const seen = new Set(keyword.map((r) => r.id))
  return withAvatar([...keyword, ...semantic.filter((r) => !seen.has(r.id))])
}

/** Счётчик списков под текущий запрос (для бейджа scope-переключателя). По ключевым
    словам, без семантики — этого достаточно для числа рядом с вкладкой. */
export async function countLists(
  opts: { q?: string; tag?: string; verified?: boolean; ordered?: boolean; by?: string; tags?: string[]; minStars?: number } = {},
  viewerId?: string,
): Promise<number> {
  const filters: SQL[] = [visibleFilter(viewerId), ...extraFilters(opts)]
  if (opts.tag) filters.push(tagFilter(opts.tag))
  const q = opts.q?.trim()
  if (q) {
    const like = `%${q}%`
    filters.push(
      or(ilike(sql`${templates.title}::text`, like), ilike(sql`${templates.desc}::text`, like), ilike(templates.slug, like))!,
    )
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(...filters))
  return row?.n ?? 0
}

/** Закреплённые списки пользователя (для профиля). */
export async function getPinnedTemplates(userId: string, viewerId?: string): Promise<FeedItem[]> {
  const rows = await db
    .select(FEED_COLS)
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(templates.ownerId, userId), eq(templates.pinned, true), visibleFilter(viewerId)))
    .orderBy(desc(templates.updatedAt))
  return withAvatar(rows as FeedItem[])
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

/** Списки внутри каталога (repository). */
export async function getListsInCatalog(repositoryId: string, viewerId?: string): Promise<FeedItem[]> {
  const rows = await db
    .select(FEED_COLS)
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(templates.repositoryId, repositoryId), visibleFilter(viewerId)))
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

/** Лента изменений: недавние версии (создание/правки) списков.
 *  scope — если задан, ограничивает ленту авторами и/или конкретными списками (OR). */
export async function getActivity(
  limit = 30,
  viewerId?: string,
  scope?: { ownerIds?: string[]; templateIds?: string[] },
): Promise<ActivityItem[]> {
  const ownerIds = scope?.ownerIds ?? []
  const templateIds = scope?.templateIds ?? []
  if (scope && ownerIds.length === 0 && templateIds.length === 0) return []
  const filters: SQL[] = [visibleFilter(viewerId)]
  if (scope) {
    const ors: SQL[] = []
    if (ownerIds.length) ors.push(inArray(templates.ownerId, ownerIds))
    if (templateIds.length) ors.push(inArray(templates.id, templateIds))
    filters.push(ors.length === 1 ? ors[0] : or(...ors)!)
  }
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
    .where(and(...filters))
    .orderBy(desc(templateVersions.createdAt))
    .limit(limit)
  return withAvatar(rows as ActivityItem[])
}

/** Предложения правок для списка (с авторами). */
export async function getSuggestions(templateId: string) {
  const rows = await db
    .select({
      id: suggestions.id,
      status: suggestions.status,
      note: suggestions.note,
      baseVersion: suggestions.baseVersion,
      items: suggestions.items,
      createdAt: suggestions.createdAt,
      authorHandle: users.handle,
      authorAvatarUrl: users.avatarUrl,
      commentCount: sql<number>`(select count(*)::int from ${suggestionComments} sc where sc.suggestion_id = ${suggestions.id})`,
    })
    .from(suggestions)
    .innerJoin(users, eq(suggestions.authorId, users.id))
    .where(eq(suggestions.templateId, templateId))
    .orderBy(asc(suggestions.status), desc(suggestions.createdAt))
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      author: { handle: r.authorHandle, avatarUrl: await avatarSrc(r.authorAvatarUrl, 64) },
    })),
  )
}

/** Одно предложение с автором (для страницы-обсуждения). */
export async function getSuggestion(templateId: string, id: string) {
  const row = await db.query.suggestions.findFirst({
    where: (s, { and: a, eq: e }) => a(e(s.id, id), e(s.templateId, templateId)),
    with: { author: true },
  })
  if (!row) return null
  return { ...row, author: { ...row.author, avatarUrl: await avatarSrc(row.author.avatarUrl, 64) } }
}

/** Комментарии-обсуждение к предложению. */
export async function getSuggestionComments(suggestionId: string) {
  const rows = await db
    .select({
      id: suggestionComments.id,
      body: suggestionComments.body,
      createdAt: suggestionComments.createdAt,
      authorId: suggestionComments.authorId,
      authorHandle: users.handle,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(suggestionComments)
    .innerJoin(users, eq(suggestionComments.authorId, users.id))
    .where(eq(suggestionComments.suggestionId, suggestionId))
    .orderBy(asc(suggestionComments.createdAt))
  return Promise.all(rows.map(async (r) => ({ ...r, authorAvatarUrl: await avatarSrc(r.authorAvatarUrl, 48) })))
}

export interface Contributor {
  handle: string
  avatarUrl: string | null
  accepted: number // сколько правок принято (0 = только автор/предлагал)
}

/** Контрибьюторы списка: владелец + авторы предложений (принятые впереди). */
export async function getContributors(templateId: string, ownerId: string): Promise<Contributor[]> {
  const rows = await db
    .select({
      handle: users.handle,
      avatarUrl: users.avatarUrl,
      authorId: suggestions.authorId,
      accepted: sql<number>`count(*) filter (where ${suggestions.status} = 'accepted')::int`,
    })
    .from(suggestions)
    .innerJoin(users, eq(suggestions.authorId, users.id))
    .where(eq(suggestions.templateId, templateId))
    .groupBy(users.handle, users.avatarUrl, suggestions.authorId)

  const [owner] = await db.select({ handle: users.handle, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, ownerId)).limit(1)
  const list: Contributor[] = []
  if (owner) list.push({ handle: owner.handle, avatarUrl: owner.avatarUrl, accepted: Infinity })
  for (const r of rows) {
    if (r.authorId === ownerId) continue
    list.push({ handle: r.handle, avatarUrl: r.avatarUrl, accepted: r.accepted })
  }
  list.sort((a, b) => b.accepted - a.accepted)
  return Promise.all(list.map(async (c) => ({ ...c, avatarUrl: await avatarSrc(c.avatarUrl, 48), accepted: Number.isFinite(c.accepted) ? c.accepted : 0 })))
}

/** Число открытых предложений. */
export async function getOpenSuggestionCount(templateId: string): Promise<number> {
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(suggestions)
    .where(and(eq(suggestions.templateId, templateId), eq(suggestions.status, 'open')))
  return r?.c ?? 0
}

/** Отметил ли пользователь список звездой. Через порт CurationStore. */
export const isStarred = (templateId: string, userId: string) => curationStore.isStarred(templateId, userId)

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
      status: templates.status,
      ordered: templates.ordered,
      pinned: templates.pinned,
      repositoryId: templates.repositoryId,
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

/** Шаги конкретной версии (по номеру) — для диффа версий. */
export async function getVersionSteps(templateId: string, version: number) {
  const [v] = await db
    .select({ id: templateVersions.id, note: templateVersions.note, createdAt: templateVersions.createdAt })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, templateId), eq(templateVersions.version, version)))
    .limit(1)
  if (!v) return null
  const rows = await db
    .select()
    .from(steps)
    .where(eq(steps.versionId, v.id))
    .orderBy(asc(steps.n))
  return { note: v.note, createdAt: v.createdAt, steps: rows }
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
