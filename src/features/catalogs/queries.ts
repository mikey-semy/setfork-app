import 'server-only'
import { and, asc, count, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { db, publiclyVisible, repositories, templates, users } from '@/shared/db'
import { tr, type Lang, type LocaleText } from '@/shared/i18n'
import type { CatalogProfile } from '@/shared/lib/catalog-match'
import { avatarSrc } from '@/shared/media'

export interface PublicCatalog {
  id: string
  name: string
  title: LocaleText
  desc: LocaleText
  ownerHandle: string
  ownerAvatarUrl: string | null
  listCount: number
}

/** Публичные каталоги (репозитории списков) для витрины Explore → Collections.
 *  Только те, где есть хотя бы один публичный опубликованный список. */
export async function getPublicCatalogs(limit = 60): Promise<PublicCatalog[]> {
  const pubCount = sql<number>`(
    select count(*)::int from ${templates} t
    where t.repository_id = ${repositories.id}
      and t.status = 'published' and t.visibility = 'public' and t.moderation = 'active'
  )`
  const rows = await db
    .select({
      id: repositories.id,
      name: repositories.name,
      title: repositories.title,
      desc: repositories.desc,
      ownerHandle: users.handle,
      ownerAvatarUrl: users.avatarUrl,
      listCount: pubCount,
    })
    .from(repositories)
    .innerJoin(users, eq(repositories.ownerId, users.id))
    .orderBy(desc(pubCount))
    .limit(limit)
  const nonEmpty = rows.filter((r) => r.listCount > 0)
  return Promise.all(nonEmpty.map(async (r) => ({ ...r, ownerAvatarUrl: await avatarSrc(r.ownerAvatarUrl, 64) })))
}

/** Карточки каталогов по id (для подборок). Порядок не гарантирован. */
export async function getCatalogCardsByIds(ids: string[]): Promise<PublicCatalog[]> {
  if (!ids.length) return []
  const pubCount = sql<number>`(
    select count(*)::int from ${templates} t
    where t.repository_id = ${repositories.id}
      and t.status = 'published' and t.visibility = 'public' and t.moderation = 'active'
  )`
  const rows = await db
    .select({
      id: repositories.id,
      name: repositories.name,
      title: repositories.title,
      desc: repositories.desc,
      ownerHandle: users.handle,
      ownerAvatarUrl: users.avatarUrl,
      listCount: pubCount,
    })
    .from(repositories)
    .innerJoin(users, eq(repositories.ownerId, users.id))
    .where(inArray(repositories.id, ids))
  return Promise.all(rows.map(async (r) => ({ ...r, ownerAvatarUrl: await avatarSrc(r.ownerAvatarUrl, 64) })))
}

export interface CatalogRow {
  id: string
  name: string
  title: LocaleText
  desc: LocaleText
  listCount: number
}

/** Каталоги владельца + число списков, доступных текущему зрителю, в каждом. */
export async function getOwnerCatalogs(ownerId: string, viewerId?: string): Promise<CatalogRow[]> {
  const visibleLists = viewerId ? or(publiclyVisible(), eq(templates.ownerId, viewerId))! : publiclyVisible()
  const rows = await db
    .select({
      id: repositories.id,
      name: repositories.name,
      title: repositories.title,
      desc: repositories.desc,
      listCount: count(templates.id),
    })
    .from(repositories)
    .leftJoin(templates, and(eq(templates.repositoryId, repositories.id), visibleLists))
    .where(eq(repositories.ownerId, ownerId))
    .groupBy(repositories.id, repositories.name, repositories.title, repositories.desc)
    .orderBy(asc(repositories.name))
  return rows
}

/**
 * Полки владельца с тегами их жильцов — чтобы новому списку было что подсказать.
 *
 * Собираем одним запросом и складываем в памяти: полок у человека десятки, списков сотни,
 * это один проход по выборке. `group by` с `unnest` был бы экономнее по трафику и
 * непрозрачнее по смыслу — экономить тут пока не на чем (правило в shared/lib/catalog-match).
 */
export async function getCatalogTagProfiles(ownerId: string, lang: Lang): Promise<CatalogProfile[]> {
  const rows = await db
    .select({ name: repositories.name, title: repositories.title, tags: templates.tags })
    .from(repositories)
    .leftJoin(templates, eq(templates.repositoryId, repositories.id))
    .where(eq(repositories.ownerId, ownerId))
    .orderBy(asc(repositories.name))

  const byName = new Map<string, { title: LocaleText; tags: Set<string> }>()
  for (const row of rows) {
    const entry = byName.get(row.name) ?? { title: row.title, tags: new Set<string>() }
    for (const tag of row.tags ?? []) entry.tags.add(tag)
    byName.set(row.name, entry)
  }
  // Заголовок отдаём уже на языке зрителя: подсказка попадает прямиком в интерфейс, и
  // тащить туда сырой LocaleText значило бы решать про язык дважды.
  return [...byName].map(([name, v]) => ({ name, title: tr(v.title, lang) || name, tags: [...v.tags] }))
}

export interface CatalogDetail {
  id: string
  name: string
  title: LocaleText
  desc: LocaleText
  ownerId: string
  ownerHandle: string
}

/** Каталог по owner handle + name. */
export async function getCatalog(ownerHandle: string, name: string): Promise<CatalogDetail | null> {
  const [row] = await db
    .select({
      id: repositories.id,
      name: repositories.name,
      title: repositories.title,
      desc: repositories.desc,
      ownerId: repositories.ownerId,
      ownerHandle: users.handle,
    })
    .from(repositories)
    .innerJoin(users, eq(repositories.ownerId, users.id))
    .where(and(eq(users.handle, ownerHandle), eq(repositories.name, name)))
    .limit(1)
  return row ?? null
}
