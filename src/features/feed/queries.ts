import 'server-only'
import { and, desc, eq, inArray, ne, notInArray, or, sql, type SQL } from 'drizzle-orm'
import type { LocaleText } from '@/core'
import { db, follows, issues, stars, suggestions, templates, templateVersions, users } from '@/shared/db'
import { imageUrl } from '@/shared/media'

// Лента dashboard (Feed): события из подписок — как GitHub home feed.
// Типы событий соответствуют чекбоксам фильтра (FeedFilter):
//   version  — новая версия списка (обновление; v1 см. created/forked)
//   created  — создан список
//   forked   — форкнут список
//   star     — кто-то из подписок поставил звезду
//   follow   — кто-то из подписок подписался на человека
//   issue    — issue в отслеживаемом списке
//   suggestion — предложение правок в отслеживаемом списке
export type FeedEventType = 'version' | 'created' | 'forked' | 'star' | 'follow' | 'issue' | 'suggestion'

export interface FeedEvent {
  type: FeedEventType
  actorHandle: string
  actorAvatarUrl: string | null
  // Цель-список (кроме follow)
  ownerHandle?: string
  slug?: string
  title?: LocaleText
  version?: number
  note?: string
  // follow: на кого подписались
  targetHandle?: string
  // issue/suggestion
  itemTitle?: string
  itemId?: string
  /** Событие попало в ленту ТОЛЬКО из-за starred-списка (не watch/follow) —
   *  клиентский фильтр прячет такие при выключенной опции includeStarred. */
  viaStarred?: boolean
  createdAt: Date
}

/** Внутренние поля для вычисления viaStarred (наружу не отдаются). */
interface ScopedRow {
  templateId?: string
  ownerId?: string
}

// Публичный + опубликованный + активный. Без status='published' в ленту/рекомендации
// просачивались публичные черновики (title/slug/note/версии).
const visible = (): SQL => sql`${templates.visibility} = 'public' and ${templates.status} = 'published' and ${templates.moderation} = 'active'`

async function withAvatars<T extends { actorAvatarUrl: string | null }>(rows: T[]): Promise<T[]> {
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      actorAvatarUrl: r.actorAvatarUrl ? await imageUrl(r.actorAvatarUrl, 'rs:fill:96:96') : null,
    })),
  )
}

/** События версий/созданий/форков от авторов из подписок и по спискам из watch/stars. */
async function versionEvents(ownerIds: string[], templateIds: string[], limit: number): Promise<FeedEvent[]> {
  const ors: SQL[] = []
  if (ownerIds.length) ors.push(inArray(templates.ownerId, ownerIds))
  if (templateIds.length) ors.push(inArray(templates.id, templateIds))
  if (!ors.length) return []
  const rows = await db
    .select({
      templateId: templates.id,
      ownerId: templates.ownerId,
      actorHandle: users.handle,
      actorAvatarUrl: users.avatarUrl,
      ownerHandle: users.handle,
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
    .where(and(visible(), ors.length === 1 ? ors[0] : or(...ors)!))
    .orderBy(desc(templateVersions.createdAt))
    .limit(limit)
  return rows.map((r) => ({
    ...r,
    type: r.version === 1 ? (r.origin === 'forked' ? ('forked' as const) : ('created' as const)) : ('version' as const),
  }))
}

/** Звёзды от людей из подписок (created_at звезды = момент события). */
async function starEvents(ownerIds: string[], limit: number): Promise<FeedEvent[]> {
  if (!ownerIds.length) return []
  const rows = await db
    .select({
      actorHandle: users.handle,
      actorAvatarUrl: users.avatarUrl,
      ownerHandle: sql<string>`(select handle from ${users} u2 where u2.id = ${templates.ownerId})`,
      slug: templates.slug,
      title: templates.title,
      createdAt: stars.createdAt,
    })
    .from(stars)
    .innerJoin(users, eq(stars.userId, users.id))
    .innerJoin(templates, eq(stars.templateId, templates.id))
    .where(and(inArray(stars.userId, ownerIds), visible()))
    .orderBy(desc(stars.createdAt))
    .limit(limit)
  return rows.map((r) => ({ ...r, type: 'star' as const }))
}

/** Подписки людей из подписок («X подписался на Y»). */
async function followEvents(ownerIds: string[], limit: number): Promise<FeedEvent[]> {
  if (!ownerIds.length) return []
  const target = sql<string>`(select handle from ${users} u2 where u2.id = ${follows.followingId})`
  const rows = await db
    .select({
      actorHandle: users.handle,
      actorAvatarUrl: users.avatarUrl,
      targetHandle: target,
      createdAt: follows.createdAt,
    })
    .from(follows)
    .innerJoin(users, eq(follows.followerId, users.id))
    .where(inArray(follows.followerId, ownerIds))
    .orderBy(desc(follows.createdAt))
    .limit(limit)
  return rows.map((r) => ({ ...r, type: 'follow' as const }))
}

/** Issues и предложения в отслеживаемых списках. */
async function activityEvents(templateIds: string[], limit: number): Promise<FeedEvent[]> {
  if (!templateIds.length) return []
  const ownerH = sql<string>`(select handle from ${users} u2 where u2.id = ${templates.ownerId})`
  const [iss, sug] = await Promise.all([
    db
      .select({
        templateId: templates.id,
        actorHandle: users.handle,
        actorAvatarUrl: users.avatarUrl,
        ownerHandle: ownerH,
        slug: templates.slug,
        title: templates.title,
        itemTitle: issues.title,
        itemId: issues.id,
        createdAt: issues.createdAt,
      })
      .from(issues)
      .innerJoin(users, eq(issues.authorId, users.id))
      .innerJoin(templates, eq(issues.templateId, templates.id))
      .where(and(inArray(issues.templateId, templateIds), visible()))
      .orderBy(desc(issues.createdAt))
      .limit(limit),
    db
      .select({
        templateId: templates.id,
        actorHandle: users.handle,
        actorAvatarUrl: users.avatarUrl,
        ownerHandle: ownerH,
        slug: templates.slug,
        title: templates.title,
        itemTitle: suggestions.note,
        itemId: suggestions.id,
        createdAt: suggestions.createdAt,
      })
      .from(suggestions)
      .innerJoin(users, eq(suggestions.authorId, users.id))
      .innerJoin(templates, eq(suggestions.templateId, templates.id))
      .where(and(inArray(suggestions.templateId, templateIds), visible()))
      .orderBy(desc(suggestions.createdAt))
      .limit(limit),
  ])
  return [
    ...iss.map((r) => ({ ...r, type: 'issue' as const })),
    ...sug.map((r) => ({ ...r, type: 'suggestion' as const })),
  ]
}

export interface FeedScope {
  followingIds: string[] // на кого подписан
  watchedIds: string[] // отслеживаемые списки
  starredIds: string[] // starred-списки (вкл. опцией фильтра)
}

/** Собранная лента: N свежих событий каждого типа → merge по времени. */
export async function getFeedEvents(scope: FeedScope, limit = 40): Promise<FeedEvent[]> {
  // Всегда включаем starred в выборку; событиям «только из-за звезды» ставим
  // viaStarred — опцию includeStarred применяет клиент без рефетча (prefs.ts).
  const tplIds = [...new Set([...scope.watchedIds, ...scope.starredIds])]
  const per = Math.min(limit, 25)
  const [versions, starsEv, followsEv, activity] = await Promise.all([
    versionEvents(scope.followingIds, tplIds, per),
    starEvents(scope.followingIds, per),
    followEvents(scope.followingIds, per),
    activityEvents(tplIds, per),
  ])
  const watched = new Set(scope.watchedIds)
  const followed = new Set(scope.followingIds)
  const tagged = [...versions, ...starsEv, ...followsEv, ...activity].map((e) => {
    const { templateId, ownerId, ...ev } = e as FeedEvent & ScopedRow
    const viaStarred =
      !!templateId && !watched.has(templateId) && (!ownerId || !followed.has(ownerId))
    return viaStarred ? { ...ev, viaStarred } : ev
  })
  return withAvatars(tagged.sort((a, b) => +b.createdAt - +a.createdAt).slice(0, limit))
}

export interface RecommendedList {
  ownerHandle: string
  slug: string
  title: LocaleText
  starsCount: number
  tags: string[]
}

/** «Recommended for you»: популярное, что пользователь ещё не звездил и не его. */
export async function getRecommended(userId: string, excludeStarred: string[], limit = 4): Promise<RecommendedList[]> {
  const filters: SQL[] = [visible(), ne(templates.ownerId, userId)]
  if (excludeStarred.length) filters.push(notInArray(templates.id, excludeStarred))
  return db
    .select({
      ownerHandle: users.handle,
      slug: templates.slug,
      title: templates.title,
      starsCount: templates.starsCount,
      tags: templates.tags,
    })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(...filters))
    .orderBy(desc(templates.starsCount), desc(templates.updatedAt))
    .limit(limit)
}

/** Id starred-списков пользователя (для scope и исключения из рекомендаций). */
export async function getStarredIds(userId: string): Promise<string[]> {
  const rows = await db.select({ id: stars.templateId }).from(stars).where(eq(stars.userId, userId))
  return rows.map((r) => r.id)
}
