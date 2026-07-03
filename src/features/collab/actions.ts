'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { collaborators, db, templates, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'

async function ownerGuard(templateId: string, userId: string) {
  const [tpl] = await db
    .select({ id: templates.id, ownerId: templates.ownerId, slug: templates.slug })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1)
  if (!tpl || tpl.ownerId !== userId) return null
  const [owner] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, tpl.ownerId)).limit(1)
  return owner ? { ...tpl, ownerHandle: owner.handle } : null
}

/** Добавить коллаборатора по handle (только владелец). */
export async function addCollaborator(templateId: string, formData: FormData): Promise<void> {
  const session = await requireSession()
  const tpl = await ownerGuard(templateId, session.userId)
  if (!tpl) return
  const handle = String(formData.get('handle') ?? '').trim().replace(/^@/, '')
  if (!handle) return
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.handle, handle)).limit(1)
  if (!u || u.id === tpl.ownerId) return // нет такого / это владелец
  await db.insert(collaborators).values({ templateId, userId: u.id, role: 'write' }).onConflictDoNothing()
  revalidatePath(`/${tpl.ownerHandle}/${tpl.slug}/settings`)
}

/** Убрать коллаборатора (только владелец). */
export async function removeCollaborator(templateId: string, userId: string): Promise<void> {
  const session = await requireSession()
  const tpl = await ownerGuard(templateId, session.userId)
  if (!tpl) return
  await db.delete(collaborators).where(and(eq(collaborators.templateId, templateId), eq(collaborators.userId, userId)))
  revalidatePath(`/${tpl.ownerHandle}/${tpl.slug}/settings`)
}
