import 'server-only'
import { and, cosineDistance, desc, eq, gte, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm'
import { db, embeddings, stars, templates, templateVersions, users, publiclyVisible } from '@/shared/db'
import type { Lang } from '@/shared/i18n'
import { avatarSrc, imageUrl } from '@/shared/media'
import { getSearchSettings } from '@/shared/settings/search'
import { checkRateLimit } from '@/shared/ai/rate-limit'
import type { ActivityItem, FeedItem, FeedSort, ListSuggestion, TagRow, TrendRange } from './list'
import { descText, extraFilters, FEED_COLS, langPref, keywordFeed, searchCondition, semanticFeed, tagFilter, titleText, visibleFilter, withAvatar } from './shared'

/**
 * Ленты и поиск: обзор, тренды, подборки, списки пользователя, активность, теги.
 *
 * Отдельно от чтений одного списка: тут своя причина меняться — правила выдачи и
 * ранжирования, а не форма самого списка.
 */

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
  /** Окно страницы. Для выдачи БЕЗ запроса уезжает прямо в SQL; при поиске см. ниже. */
  window?: { limit: number; offset?: number },
): Promise<FeedItem[]> {
  const order =
    opts.sort === 'newest'
      ? desc(templates.updatedAt)
      : opts.sort === 'mostStarred'
        ? desc(templates.starsCount)
        : desc(sql`${templates.starsCount} + ${templates.forksCount}`) // trending

  const extra = extraFilters(opts)
  const q = opts.q?.trim()
  if (!q) return withAvatar(await keywordFeed(order, viewerId, opts.tag, undefined, extra, viewerLang, window))

  const { mode, minScore, limit } = await getSearchSettings()
  // ПОИСК режется в памяти, а не в SQL, и это не небрежность: гибридный режим склеивает
  // две РАЗНЫЕ выдачи (точные совпадения и близкие по смыслу), а такой порядок в одном
  // запросе не выражается. Безразмерным он от этого не становится: обе ветки ограничены
  // потолком поиска из настроек, а окно применяется к уже склеенному.
  const cap = { limit }
  const page = (rows: FeedItem[]) => (window ? rows.slice(window.offset ?? 0, (window.offset ?? 0) + window.limit) : rows)
  // Семантика тратит embedding-вызов OpenRouter. Разрешаем её только залогиненным и
  // под rate-limit: иначе аноним в цикле GET /search?q=... жёг бы деньги без учёта.
  // Гость и превышенный лимит → keyword-поиск (0 токенов), тот же результат-фолбэк.
  const canSemantic = mode !== 'keyword' && !!viewerId && (await checkRateLimit(`search:${viewerId}`)).allowed
  if (!canSemantic) return withAvatar(page(await keywordFeed(order, viewerId, opts.tag, q, extra, viewerLang, cap)))

  const semantic = await semanticFeed(q, opts.tag, limit, minScore, viewerId, extra)
  // Нет вектора (нет ключа/эмбеддингов) → откат на ключевые слова.
  if (!semantic) return withAvatar(page(await keywordFeed(order, viewerId, opts.tag, q, extra, viewerLang, cap)))
  if (mode === 'semantic') return withAvatar(page(semantic))

  // hybrid: сначала ТОЧНЫЕ совпадения по словам (буквальное «ubuntu» точнее),
  // затем добираем по смыслу — чтобы семантически-похожее не всплывало над точным.
  const keyword = await keywordFeed(order, viewerId, opts.tag, q, extra, viewerLang, cap)
  const seen = new Set(keyword.map((r) => r.id))
  return withAvatar(page([...keyword, ...semantic.filter((r) => !seen.has(r.id))]))
}

/** Тренд за период: списки с наибольшим приростом звёзд за range (day/week/month),
 *  при равенстве — по суммарным звёздам+форкам. 'all' — просто trending. */
export async function getTrendingFeed(
  range: TrendRange,
  viewerId?: string,
  viewerLang?: Lang,
  window?: { limit: number; offset?: number },
): Promise<FeedItem[]> {
  if (range === 'all') return getFeed({ sort: 'trending' }, viewerId, viewerLang, window)
  const days = range === 'day' ? 1 : range === 'week' ? 7 : 30
  const gained = sql`(select count(*)::int from ${stars} s where s.template_id = ${templates.id} and s.created_at >= now() - make_interval(days => ${days}))`
  const order = desc(sql`${gained} * 1000 + ${templates.starsCount} + ${templates.forksCount}`)
  return withAvatar(await keywordFeed(order, viewerId, undefined, undefined, [], viewerLang, window))
}

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
        publiclyVisible(),
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

/**
 * Списки пользователя. viewerId = кто смотрит: владелец видит и приватные.
 *
 * ОКНО ОБЯЗАТЕЛЬНО, и вот почему. До 13.08.2026 функция отдавала ВСЁ без предела,
 * а звали её четыре поверхности, включая корневой layout — то есть на КАЖДОЙ
 * странице сайта из базы поднимались все списки владельца (у владельца их 518)
 * со всеми колонками ленты и резолвом аватара, чтобы показать десять. Дашборд
 * при этом отправлял всю пачку в браузер, и кнопка «Показать ещё» просто
 * раскрывала уже загруженное — отсюда жалоба «открывает весь список, это ужасно».
 *
 * Курсор здесь не нужен: сортировка по updatedAt, а окно небольшое и
 * листается вперёд. Смещение считает вызывающий.
 */
export async function getUserTemplates(
  userId: string,
  viewerId?: string,
  window?: { limit: number; offset?: number },
  /** Отбор сохранённым запросом: он считает подходящие id отдельно (там свои условия про
   *  прогоны), и без этого фильтра страницу пришлось бы резать ПОСЛЕ загрузки — то есть
   *  отдавать по двадцать штук из отфильтрованного вслепую. */
  onlyIds?: string[],
): Promise<FeedItem[]> {
  if (onlyIds && !onlyIds.length) return []
  const q = db
    .select(FEED_COLS)
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(templates.ownerId, userId), visibleFilter(viewerId), onlyIds ? inArray(templates.id, onlyIds) : undefined))
    .orderBy(desc(templates.updatedAt))
  const rows = window ? await q.limit(window.limit).offset(window.offset ?? 0) : await q
  return withAvatar(rows as FeedItem[])
}

/** Сколько всего списков у пользователя видно этому зрителю — для «показать ещё». */
export async function countUserTemplates(userId: string, viewerId?: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(templates)
    .where(and(eq(templates.ownerId, userId), visibleFilter(viewerId)))
  return r?.n ?? 0
}

/** Списки автора для переключателя в шапке: чей список открыт — того и набор.
 *  Поиск идёт по ВСЕМ его спискам, а не по загруженной горстке недавних.
 *  Пустой запрос = недавние. Приватные отдаются только владельцу (visibleFilter). */
export async function searchTemplatesByOwnerHandle(
  handle: string,
  viewerId: string | undefined,
  q: string,
  limit = 20,
): Promise<FeedItem[]> {
  const term = q.trim()
  const like = `%${term}%`
  const rows = await db
    .select(FEED_COLS)
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(
      and(
        eq(users.handle, handle),
        visibleFilter(viewerId),
        term ? or(ilike(titleText, like), ilike(templates.slug, like))! : undefined,
      ),
    )
    .orderBy(desc(templates.updatedAt))
    .limit(limit)
  return withAvatar(rows as FeedItem[])
}

/** Списки внутри каталога (repository). */
export async function countListsInCatalog(repositoryId: string, viewerId?: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(templates)
    .where(and(eq(templates.repositoryId, repositoryId), visibleFilter(viewerId)))
  return r?.n ?? 0
}

export async function getListsInCatalog(repositoryId: string, viewerId?: string, window?: { limit: number; offset?: number }): Promise<FeedItem[]> {
  const base = db
    .select(FEED_COLS)
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(templates.repositoryId, repositoryId), visibleFilter(viewerId)))
    .orderBy(desc(templates.updatedAt))
  const rows = window ? await base.limit(window.limit).offset(window.offset ?? 0) : await base
  return withAvatar(rows as FeedItem[])
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

/** ID списков, отмеченных звездой пользователем (для карточек ленты). */
export async function getStarredIds(userId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = await db
    .select({ t: stars.templateId })
    .from(stars)
    .where(and(eq(stars.userId, userId), inArray(stars.templateId, ids)))
  return new Set(rows.map((r) => r.t))
}
