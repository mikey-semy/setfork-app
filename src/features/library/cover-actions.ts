'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, templates, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { isCollaborator } from '@/features/collab/queries'
import { imageUrl } from '@/shared/media'
import { removeImageFile, uploadImageFile } from '@/shared/media/upload'
import { isHexColor } from '@/features/issues/labels'

// Обложка списка (list-level, не версионируется — вне git-проекции). Владелец
// или коллаборатор. Обложка/акцент используются на витрине и авто-баннере.
async function canManage(templateId: string, userId: string): Promise<{ owner: string; slug: string } | null> {
  const [t] = await db
    .select({ ownerId: templates.ownerId, slug: templates.slug, handle: users.handle })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(eq(templates.id, templateId))
    .limit(1)
  if (!t) return null
  if (t.ownerId !== userId && !(await isCollaborator(templateId, userId))) return null
  return { owner: t.handle, slug: t.slug }
}

export async function setListCover(formData: FormData): Promise<{ ok: true; url: string } | { error: string }> {
  const session = await requireSession()
  const templateId = String(formData.get('templateId') ?? '')
  const file = formData.get('file')
  const can = await canManage(templateId, session.userId)
  if (!can) return { error: 'forbidden' }
  if (!(file instanceof File) || file.size === 0) return { error: 'nofile' }
  try {
    const ref = await uploadImageFile('covers', file)
    const [prev] = await db.select({ cover: templates.coverImage }).from(templates).where(eq(templates.id, templateId)).limit(1)
    await db.update(templates).set({ coverImage: ref }).where(eq(templates.id, templateId))
    if (prev?.cover) await removeImageFile(prev.cover)
    revalidatePath(`/${can.owner}/${can.slug}`)
    return { ok: true, url: (await imageUrl(ref, 'rs:fill:640:200')) ?? '' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'fail' }
  }
}

export async function removeListCover(templateId: string): Promise<void> {
  const session = await requireSession()
  const can = await canManage(templateId, session.userId)
  if (!can) return
  const [prev] = await db.select({ cover: templates.coverImage }).from(templates).where(eq(templates.id, templateId)).limit(1)
  await db.update(templates).set({ coverImage: null }).where(eq(templates.id, templateId))
  if (prev?.cover) await removeImageFile(prev.cover)
  revalidatePath(`/${can.owner}/${can.slug}`)
}

export async function setListAccent(templateId: string, accent: string): Promise<void> {
  const session = await requireSession()
  const can = await canManage(templateId, session.userId)
  if (!can) return
  await db.update(templates).set({ accent: isHexColor(accent) ? accent.toLowerCase() : null }).where(eq(templates.id, templateId))
  revalidatePath(`/${can.owner}/${can.slug}`)
}
