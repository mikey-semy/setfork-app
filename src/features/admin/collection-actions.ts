'use server'

import { and, eq, sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/shared/auth/admin'
import { db, collectionItems, collections, repositories, templates, users } from '@/shared/db'
import { removeImageFile, uploadImageFile } from '@/shared/media/upload'
import { slugify } from '@/features/library/slug'
import { isHexColor } from '@/features/issues/labels'

export async function createCollection(formData: FormData): Promise<void> {
  const admin = await requireAdmin()
  const title = String(formData.get('title') ?? '').trim().slice(0, 120)
  if (!title) redirect('/admin/collections')
  const baseSlug = slugify(title) || 'collection'
  let slug = baseSlug
  let id: string | undefined
  for (let i = 0; i < 3 && !id; i++) {
    const [row] = await db.insert(collections).values({ slug, title: { en: title }, curatorId: admin.userId }).onConflictDoNothing().returning({ id: collections.id })
    if (row) id = row.id
    else slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`
  }
  revalidatePath('/admin/collections')
  redirect(id ? `/admin/collections/${id}` : '/admin/collections')
}

export async function updateCollection(formData: FormData): Promise<void> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const title = String(formData.get('title') ?? '').trim().slice(0, 120)
  const desc = String(formData.get('desc') ?? '').trim().slice(0, 400)
  const accentRaw = String(formData.get('accent') ?? '')
  const published = formData.get('published') === 'on'
  if (!id || !title) redirect('/admin/collections')
  await db
    .update(collections)
    .set({ title: { en: title }, desc: desc ? { en: desc } : {}, accent: isHexColor(accentRaw) ? accentRaw.toLowerCase() : null, published, updatedAt: new Date() })
    .where(eq(collections.id, id))
  revalidatePath('/admin/collections')
  revalidatePath(`/admin/collections/${id}`)
  redirect(`/admin/collections/${id}`)
}

export async function deleteCollection(id: string): Promise<void> {
  await requireAdmin()
  const [c] = await db.select({ cover: collections.coverImage }).from(collections).where(eq(collections.id, id)).limit(1)
  await db.delete(collections).where(eq(collections.id, id))
  if (c?.cover) await removeImageFile(c.cover)
  revalidatePath('/admin/collections')
  redirect('/admin/collections')
}

export async function setCollectionCover(formData: FormData): Promise<void> {
  await requireAdmin()
  const id = String(formData.get('id') ?? '')
  const file = formData.get('file')
  if (!id || !(file instanceof File) || file.size === 0) redirect(`/admin/collections/${id}`)
  const ref = await uploadImageFile('collections', file as File)
  const [prev] = await db.select({ cover: collections.coverImage }).from(collections).where(eq(collections.id, id)).limit(1)
  await db.update(collections).set({ coverImage: ref }).where(eq(collections.id, id))
  if (prev?.cover) await removeImageFile(prev.cover)
  revalidatePath(`/admin/collections/${id}`)
  redirect(`/admin/collections/${id}`)
}

/** Добавить элемент по ссылке «owner/slug» (список) или «owner/name» (каталог). */
export async function addCollectionItem(formData: FormData): Promise<void> {
  await requireAdmin()
  const collectionId = String(formData.get('collectionId') ?? '')
  const kind = String(formData.get('kind') ?? 'list') === 'catalog' ? 'catalog' : 'list'
  const ref = String(formData.get('ref') ?? '').trim().replace(/^\/+/, '')
  const back = `/admin/collections/${collectionId}`
  const [owner, name] = ref.split('/')
  if (!collectionId || !owner || !name) redirect(back)

  let refId: string | null = null
  if (kind === 'list') {
    const [r] = await db.select({ id: templates.id }).from(templates).innerJoin(users, eq(templates.ownerId, users.id)).where(and(eq(users.handle, owner), eq(templates.slug, name))).limit(1)
    refId = r?.id ?? null
  } else {
    const [r] = await db.select({ id: repositories.id }).from(repositories).innerJoin(users, eq(repositories.ownerId, users.id)).where(and(eq(users.handle, owner), eq(repositories.name, name))).limit(1)
    refId = r?.id ?? null
  }
  if (!refId) redirect(`${back}?e=notfound`)

  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${collectionItems.position}),0)::int` }).from(collectionItems).where(eq(collectionItems.collectionId, collectionId))
  await db.insert(collectionItems).values({ collectionId, kind, refId, position: (max ?? 0) + 1 }).onConflictDoNothing()
  revalidatePath(back)
  redirect(back)
}

export async function removeCollectionItem(itemId: string, collectionId: string): Promise<void> {
  await requireAdmin()
  await db.delete(collectionItems).where(eq(collectionItems.id, itemId))
  revalidatePath(`/admin/collections/${collectionId}`)
}
