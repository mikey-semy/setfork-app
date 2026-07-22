import 'server-only'
import { and, asc, cosineDistance, desc, eq, gte, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm'
import { db, embeddings, stars, steps, suggestionComments, suggestions, templates, templateVersions, users } from '@/shared/db'
import type { Lang, LocaleText } from '@/shared/i18n'
import { avatarSrc, imageUrl } from '@/shared/media'
import { getSearchSettings } from '@/shared/settings/search'
import { checkRateLimit } from '@/shared/ai/rate-limit'
import { curationStore } from '@/features/curation/store'

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

// Резолвим ownerAvatarUrl + обложку (storage_key → подписанный imgproxy-URL) в
// том же поле (как аватар): после withAvatar coverImage хранит готовый URL.
async function withAvatar<T extends { ownerAvatarUrl: string | null; coverImage?: string | null }>(rows: T[]): Promise<T[]> {
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      ownerAvatarUrl: await avatarSrc(r.ownerAvatarUrl, 96),
      ...(('coverImage' in r) ? { coverImage: r.coverImage ? await imageUrl(r.coverImage, 'rs:fill:640:200') : null } : {}),
    })),
  )
}

export type FeedSort = 'trending' | 'newest' | 'mostStarred'

/** Обложка+акцент списка (для настроек и шапки). coverUrl — готовый URL или null. */
export async function getListCover(templateId: string): Promise<{ coverUrl: string | null; accent: string | null }> {
  const [r] = await db.select({ cover: templates.coverImage, accent: templates.accent }).from(templates).where(eq(templates.id, templateId)).limit(1)
  return { coverUrl: r?.cover ? await imageUrl(r.cover, 'rs:fill:1200:400') : null, accent: r?.accent ?? null }
}

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
  accent?: string | null
  coverImage?: string | null // после withAvatar — готовый URL обложки (null/undef → авто-баннер)
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
  accent: templates.accent,
  coverImage: templates.coverImage,
}

const tagFilter = (tag: string): SQL => sql`${templates.tags} @> ARRAY[${tag}]::text[]`

// ── Keyword-поиск ────────────────────────────────────────────────────
// Выражения ДОЛЖНЫ буквально совпадать с индексами 0027_search_fts.sql,
// иначе Postgres не сможет использовать trgm/FTS GIN и уйдёт в seq scan.
const titleText = sql`(coalesce(${templates.title}->>'en','') || ' ' || coalesce(${templates.title}->>'ru',''))`
const descText = sql`(coalesce(${templates.desc}->>'en','') || ' ' || coalesce(${templates.desc}->>'ru',''))`

/** Условие поиска: подстрока (ILIKE через trgm-GIN) + мультисловный FTS
 *  (websearch_to_tsquery, 'simple' — без стемминга, контент EN/RU) +
 *  word_similarity (<%) — устойчивость к опечаткам в заголовке. */
function searchCondition(q: string): SQL {
  const like = `%${q}%`
  return or(
    ilike(titleText, like),
    ilike(descText, like),
    ilike(templates.slug, like),
    sql`to_tsvector('simple', ${titleText} || ' ' || ${descText} || ' ' || ${templates.slug}) @@ websearch_to_tsquery('simple', ${q})`,
    sql`${q} <% ${titleText}`,
  )!
}

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

/** Предпочтение языка зрителя в выдаче (ADR-0009: один пул, язык — свойство
 *  списка): списки, у которых есть title на языке зрителя, идут раньше —
 *  внутри групп действует основной order. Ключ jsonb `?` = наличие перевода. */
const langPref = (lang: Lang): SQL => desc(sql`(${templates.title} ? ${lang})::int`)

/** Поиск/лента по ключевым словам (ILIKE по всем языкам сразу). q пустой = просто лента. */
async function keywordFeed(order: SQL, viewerId?: string, tag?: string, q?: string, extra: SQL[] = [], viewerLang?: Lang): Promise<FeedItem[]> {
  const filters: SQL[] = [visibleFilter(viewerId), ...extra]
  if (tag) filters.push(tagFilter(tag))
  if (q) filters.push(searchCondition(q))
  const rows = await db
    .select(FEED_COLS)
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(...filters))
    .orderBy(...(viewerLang ? [langPref(viewerLang)] : []), order)
  return rows as FeedItem[]
}

/** Карточки списков по id (для подборок): только видимые публичные, порядок не гарантирован. */
export async function getListCardsByIds(ids: string[]): Promise<FeedItem[]> {
  if (!ids.length) return []
  const rows = await db
    .select(FEED_COLS)
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(inArray(templates.id, ids), visibleFilter()))
  return withAvatar(rows as FeedItem[])
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
  const { embedOne } = await import('@/shared/ai/embeddings')
  const vec = await embedOne(q, 'query', { userId: viewerId ?? null, refType: 'search' })
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
  viewerLang?: Lang,
): Promise<FeedItem[]> {
  const order =
    opts.sort === 'newest'
      ? desc(templates.updatedAt)
      : opts.sort === 'mostStarred'
        ? desc(templates.starsCount)
        : desc(sql`${templates.starsCount} + ${templates.forksCount}`) // trending

  const extra = extraFilters(opts)
  const q = opts.q?.trim()
  if (!q) return withAvatar(await keywordFeed(order, viewerId, opts.tag, undefined, extra, viewerLang))

  const { mode, minScore, limit } = await getSearchSettings()
  // Семантика тратит embedding-вызов OpenRouter. Разрешаем её только залогиненным и
  // под rate-limit: иначе аноним в цикле GET /search?q=... жёг бы деньги без учёта.
  // Гость и превышенный лимит → keyword-поиск (0 токенов), тот же результат-фолбэк.
  const canSemantic = mode !== 'keyword' && !!viewerId && (await checkRateLimit(`search:${viewerId}`)).allowed
  if (!canSemantic) return withAvatar(await keywordFeed(order, viewerId, opts.tag, q, extra, viewerLang))

  const semantic = await semanticFeed(q, opts.tag, limit, minScore, viewerId, extra)
  // Нет вектора (нет ключа/эмбеддингов) → откат на ключевые слова.
  if (!semantic) return withAvatar(await keywordFeed(order, viewerId, opts.tag, q, extra, viewerLang))
  if (mode === 'semantic') return withAvatar(semantic)

  // hybrid: сначала ТОЧНЫЕ совпадения по словам (буквальное «ubuntu» точнее),
  // затем добираем по смыслу — чтобы семантически-похожее не всплывало над точным.
  const keyword = await keywordFeed(order, viewerId, opts.tag, q, extra, viewerLang)
  const seen = new Set(keyword.map((r) => r.id))
  return withAvatar([...keyword, ...semantic.filter((r) => !seen.has(r.id))])
}

export type TrendRange = 'day' | 'week' | 'month' | 'all'

/** Тренд за период: списки с наибольшим приростом звёзд за range (day/week/month),
 *  при равенстве — по суммарным звёздам+форкам. 'all' — просто trending. */
export async function getTrendingFeed(range: TrendRange, viewerId?: string, viewerLang?: Lang): Promise<FeedItem[]> {
  if (range === 'all') return getFeed({ sort: 'trending' }, viewerId, viewerLang)
  const days = range === 'day' ? 1 : range === 'week' ? 7 : 30
  const gained = sql`(select count(*)::int from ${stars} s where s.template_id = ${templates.id} and s.created_at >= now() - make_interval(days => ${days}))`
  const order = desc(sql`${gained} * 1000 + ${templates.starsCount} + ${templates.forksCount}`)
  return withAvatar(await keywordFeed(order, viewerId, undefined, undefined, [], viewerLang))
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
  if (q) filters.push(searchCondition(q))
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(...filters))
  return row?.n ?? 0
}

export interface ListSuggestion {
  handle: string
  slug: string
  title: LocaleText
}

/** Быстрые подсказки списков для автокомплита в шапке (prefix/contains по title/slug). */
export async function searchListSuggestions(q: string, limit = 6): Promise<ListSuggestion[]> {
  const term = q.trim()
  if (!term) return []
  const like = `%${term}%`
  const rows = await db
    .select({ handle: users.handle, slug: templates.slug, title: templates.title })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(
      and(
        eq(templates.status, 'published'),
        eq(templates.visibility, 'public'),
        eq(templates.moderation, 'active'),
        or(ilike(titleText, like), ilike(templates.slug, like), sql`${term} <% ${titleText}`)!,
      ),
    )
    .orderBy(desc(sql`${templates.starsCount} + ${templates.forksCount}`))
    .limit(limit)
  return rows as ListSuggestion[]
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
  const [rows, [owner]] = await Promise.all([
    db
      .select({
        handle: users.handle,
        avatarUrl: users.avatarUrl,
        authorId: suggestions.authorId,
        accepted: sql<number>`count(*) filter (where ${suggestions.status} = 'accepted')::int`,
      })
      .from(suggestions)
      .innerJoin(users, eq(suggestions.authorId, users.id))
      .where(eq(suggestions.templateId, templateId))
      .groupBy(users.handle, users.avatarUrl, suggestions.authorId),
    db.select({ handle: users.handle, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, ownerId)).limit(1),
  ])
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
      issuesEnabled: templates.issuesEnabled,
      discussionsEnabled: templates.discussionsEnabled,
      pinned: templates.pinned,
      isTemplate: templates.isTemplate,
      repositoryId: templates.repositoryId,
      visibility: templates.visibility,
      moderation: templates.moderation,
      moderationReason: templates.moderationReason,
      appealedAt: templates.appealedAt,
      verified: templates.verified,
      archivedAt: templates.archivedAt,
      frozenAt: templates.frozenAt,
      starsCount: templates.starsCount,
      forksCount: templates.forksCount,
      runsCount: templates.runsCount,
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
