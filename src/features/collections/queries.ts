import 'server-only'
import { asc, desc, eq, sql } from 'drizzle-orm'
import { db, collectionItems, collections, repositories, templates, users } from '@/shared/db'
import type { LocaleText } from '@/shared/i18n'
import { imageUrl } from '@/shared/media'
import { getListCardsByIds, type FeedItem } from '@/features/library/queries'
import { getCatalogCardsByIds, type PublicCatalog } from '@/features/catalogs/queries'

export interface CollectionCard {
  id: string
  slug: string
  title: LocaleText
  desc: LocaleText
  coverUrl: string | null
  accent: string | null
  itemCount: number
}

async function resolveCover(ref: string | null): Promise<string | null> {
  return ref ? ((await imageUrl(ref, 'rs:fill:640:220')) ?? null) : null
}

// ВНИМАНИЕ: ${collections.id} Drizzle рендерит как голое "id" (без таблицы), а
// т.к. у collection_items тоже есть "id", в подзапросе оно связывалось с ВНУТРЕННЕЙ
// таблицей → count всегда 0. Явно квалифицируем внешнюю колонку литералом.
const itemCountSql = sql<number>`(select count(*)::int from collection_items ci where ci.collection_id = "collections"."id")`

/** Опубликованные подборки для витрины Explore. */
export async function getCollections(): Promise<CollectionCard[]> {
  const rows = await db
    .select({
      id: collections.id,
      slug: collections.slug,
      title: collections.title,
      desc: collections.desc,
      coverImage: collections.coverImage,
      accent: collections.accent,
      itemCount: itemCountSql,
    })
    .from(collections)
    .where(eq(collections.published, true))
    .orderBy(asc(collections.position), desc(collections.createdAt))
  return Promise.all(rows.map(async ({ coverImage, ...r }) => ({ ...r, coverUrl: await resolveCover(coverImage) })))
}

export interface CollectionDetail {
  id: string
  slug: string
  title: LocaleText
  desc: LocaleText
  coverUrl: string | null
  accent: string | null
  lists: FeedItem[]
  catalogs: PublicCatalog[]
}

/** Страница подборки (публичная): элементы — списки + каталоги, в порядке позиции.
 *  Осиротевшие/невидимые ссылки отсеиваются. */
export async function getCollectionDetail(slug: string): Promise<CollectionDetail | null> {
  const [c] = await db.select().from(collections).where(eq(collections.slug, slug)).limit(1)
  if (!c || !c.published) return null
  const items = await db.select({ kind: collectionItems.kind, refId: collectionItems.refId, position: collectionItems.position }).from(collectionItems).where(eq(collectionItems.collectionId, c.id)).orderBy(asc(collectionItems.position))
  const order = new Map(items.map((it, i) => [it.refId, it.position * 1000 + i]))
  const listIds = items.filter((i) => i.kind === 'list').map((i) => i.refId)
  const catalogIds = items.filter((i) => i.kind === 'catalog').map((i) => i.refId)
  const [lists, catalogs] = await Promise.all([getListCardsByIds(listIds), getCatalogCardsByIds(catalogIds)])
  lists.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  catalogs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  return { id: c.id, slug: c.slug, title: c.title, desc: c.desc, coverUrl: await resolveCover(c.coverImage), accent: c.accent, lists, catalogs }
}

// ── Админ ────────────────────────────────────────────────────────────
export interface AdminCollection {
  id: string
  slug: string
  title: LocaleText
  published: boolean
  itemCount: number
}
export async function getAdminCollections(): Promise<AdminCollection[]> {
  return db
    .select({
      id: collections.id,
      slug: collections.slug,
      title: collections.title,
      published: collections.published,
      itemCount: itemCountSql,
    })
    .from(collections)
    .orderBy(asc(collections.position), desc(collections.createdAt))
}

export interface AdminItem {
  itemId: string
  kind: string
  refId: string
  label: string // «owner/slug» или «owner/catalog» для отображения
  ok: boolean // ссылка ещё существует
}
export interface CollectionAdminDetail {
  id: string
  slug: string
  title: LocaleText
  desc: LocaleText
  coverUrl: string | null
  accent: string | null
  published: boolean
  items: AdminItem[]
}
export async function getCollectionAdmin(id: string): Promise<CollectionAdminDetail | null> {
  const [c] = await db.select().from(collections).where(eq(collections.id, id)).limit(1)
  if (!c) return null
  const rawItems = await db.select().from(collectionItems).where(eq(collectionItems.collectionId, id)).orderBy(asc(collectionItems.position))
  const items: AdminItem[] = []
  for (const it of rawItems) {
    if (it.kind === 'list') {
      const [r] = await db.select({ slug: templates.slug, handle: users.handle }).from(templates).innerJoin(users, eq(templates.ownerId, users.id)).where(eq(templates.id, it.refId)).limit(1)
      items.push({ itemId: it.id, kind: it.kind, refId: it.refId, label: r ? `${r.handle}/${r.slug}` : it.refId, ok: !!r })
    } else {
      const [r] = await db.select({ name: repositories.name, handle: users.handle }).from(repositories).innerJoin(users, eq(repositories.ownerId, users.id)).where(eq(repositories.id, it.refId)).limit(1)
      items.push({ itemId: it.id, kind: it.kind, refId: it.refId, label: r ? `${r.handle}/${r.name}` : it.refId, ok: !!r })
    }
  }
  return { id: c.id, slug: c.slug, title: c.title, desc: c.desc, coverUrl: c.coverImage ? ((await imageUrl(c.coverImage, 'rs:fill:640:220')) ?? null) : null, accent: c.accent, published: c.published, items }
}
