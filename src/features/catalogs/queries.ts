import 'server-only'
import { and, asc, eq, sql } from 'drizzle-orm'
import { db, repositories, templates, users } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'

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
