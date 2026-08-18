import 'server-only'
import { and, asc, cosineDistance, desc, eq, gte, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm'
import { db, embeddings, stars, templates, templateVersions, users, publiclyVisible } from '@/shared/db'
import type { Lang } from '@/shared/i18n'
import { avatarSrc, imageUrl } from '@/shared/media'
import { getSearchSettings } from '@/shared/settings/search'
import { feedWindow } from '@/shared/lib/paging'
import type { FeedItem } from './list'

/**
 * Общее для чтений: набор колонок карточки списка, фильтр видимости, условия поиска
 * и два способа собрать ленту — по словам и по смыслу.
 *
 * Это не публичный API библиотеки, а внутренние детали каталога: наружу их не
 * реэкспортируем, иначе фильтр видимости начнут звать мимо гейта.
 */

// Резолвим ownerAvatarUrl + обложку (storage_key → подписанный imgproxy-URL) в
// том же поле (как аватар): после withAvatar coverImage хранит готовый URL.
export async function withAvatar<T extends { ownerAvatarUrl: string | null; coverImage?: string | null }>(rows: T[]): Promise<T[]> {
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      ownerAvatarUrl: await avatarSrc(r.ownerAvatarUrl, 96),
      ...(('coverImage' in r) ? { coverImage: r.coverImage ? await imageUrl(r.coverImage, 'rs:fill:640:200') : null } : {}),
    })),
  )
}

// Колонки FeedItem — общие для ленты и поиска.
export const descText = sql`(coalesce(${templates.desc}->>'en','') || ' ' || coalesce(${templates.desc}->>'ru',''))`
export const langPref = (lang: Lang): SQL => desc(sql`(${templates.title} ? ${lang})::int`)

export const FEED_COLS = {
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
  // Каталог («полка») списка: по нему профиль фильтрует свою библиотеку, а «без каталога»
  // отвечает на вопрос «что ещё не разложено» — это и есть очередь разбора.
  repositoryId: templates.repositoryId,
}

export const tagFilter = (tag: string): SQL => sql`${templates.tags} @> ARRAY[${tag}]::text[]`

// ── Keyword-поиск ────────────────────────────────────────────────────
// Выражения ДОЛЖНЫ буквально совпадать с индексами 0027_search_fts.sql,
// иначе Postgres не сможет использовать trgm/FTS GIN и уйдёт в seq scan.
export const titleText = sql`(coalesce(${templates.title}->>'en','') || ' ' || coalesce(${templates.title}->>'ru',''))`

/**
 * ПОДСТРОКА ДЛЯ ILIKE — с экранированием, а не просто `%q%`.
 *
 * `%` и `_` — это подстановочные знаки шаблона, а не буквы запроса. Без экранирования
 * поиск по `_` возвращает вообще всё (шаблон `%_%` — «хоть один символ»), а по `100%`
 * находит «1000 шагов». Человек при этом ищет буквально то, что набрал: в памяти это был
 * обычный `includes`, и заменять его на язык шаблонов никто не просил.
 *
 * Обратный слэш — экранирующий знак LIKE по умолчанию, отдельный `ESCAPE` не нужен;
 * сам слэш поэтому экранируется первым.
 */
export const likeContains = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** Условие поиска: подстрока (ILIKE через trgm-GIN) + мультисловный FTS
 *  (websearch_to_tsquery, 'simple' — без стемминга, контент EN/RU) +
 *  word_similarity (<%) — устойчивость к опечаткам в заголовке. */
export function searchCondition(q: string): SQL {
  const like = likeContains(q)
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
export function visibleFilter(viewerId?: string): SQL {
  const publicVisible = and(
    publiclyVisible(),
  )!
  return viewerId ? or(publicVisible, eq(templates.ownerId, viewerId))! : publicVisible
}

/** Доп. фильтры ленты: verified, тип, автор (by), теги (AND), минимум звёзд. */
export function extraFilters(opts: {
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
export async function keywordFeed(
  order: SQL,
  viewerId?: string,
  tag?: string,
  q?: string,
  extra: SQL[] = [],
  viewerLang?: Lang,
  /** Окно выдачи. Без него запрос тянул ВЕСЬ видимый корпус — с аватарами авторов, —
   *  а разметка показывала из него экран: цена страницы росла вместе с порталом. */
  window?: { limit: number; offset?: number },
): Promise<FeedItem[]> {
  const filters: SQL[] = [visibleFilter(viewerId), ...extra]
  if (tag) filters.push(tagFilter(tag))
  if (q) filters.push(searchCondition(q))
  const base = db
    .select(FEED_COLS)
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(...filters))
    // `asc(id)` в хвосте — доопределение порядка. Без него на равных ключах (у trending
    // это звёзды+форки, у ленты — дата) соседние страницы вправе показать одну строку
    // дважды, а другую пропустить. Ключ уникальный, поэтому порядок становится строгим.
    .orderBy(...(viewerLang ? [langPref(viewerLang)] : []), order, asc(templates.id))
  const w = window && feedWindow(window)
  const rows = w ? await base.limit(w.limit).offset(w.offset) : await base
  return rows as FeedItem[]
}

/** Семантический поиск (pgvector cosine) с порогом схожести. null, если запрос нельзя векторизовать. */
export async function semanticFeed(
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
    // `asc(id)` в хвосте — по той же причине, что в keywordFeed, и здесь она острее.
    // Одинаковая близость — не редкость, а норма: у повторной заливки того же текста
    // эмбеддинг совпадает БИТ В БИТ, то есть distance равен точно. На равных ключах
    // порядок произволен, и рвётся не только он: `limit` отрезает выдачу по этому же
    // порядку, поэтому на границе отсечки произволен и САМ СОСТАВ — от запроса к запросу
    // в хвост попадает то одна строка, то другая. Склеенная выдача поиска режется на
    // страницы уже в памяти (getFeed), так что её страницы наследуют этот произвол
    // целиком: строка показывается дважды или не показывается ни разу.
    .orderBy(desc(similarity), asc(templates.id))
    .limit(limit)
  return rows as FeedItem[]
}
