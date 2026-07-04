import 'server-only'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db, repositories, templates, users } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
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

export interface CatalogRow {
  id: string
  name: string
  title: LocaleText
  desc: LocaleText
  listCount: number
}

/** Каталоги владельца + число списков в каждом. */
export async function getOwnerCatalogs(ownerId: string): Promise<CatalogRow[]> {
  const rows = await db
    .select({
      id: repositories.id,
      name: repositories.name,
      title: repositories.title,
      desc: repositories.desc,
      listCount: sql<number>`(select count(*)::int from ${templates} t where t.repository_id = ${repositories.id})`,
    })
    .from(repositories)
    .where(eq(repositories.ownerId, ownerId))
    .orderBy(asc(repositories.name))
  return rows
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
