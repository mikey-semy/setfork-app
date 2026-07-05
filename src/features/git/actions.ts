'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { BranchOpError } from '@/core'
import { requireSession } from '@/shared/auth/session'
import { db, templates, users } from '@/shared/db'
import { isCollaborator } from '@/features/collab/queries'
import { gitCore } from './core'

// Управление ветками (A2). Право — как у push: владелец или коллаборатор.

async function requireManage(owner: string, slug: string): Promise<void> {
  const session = await requireSession()
  const [tpl] = await db
    .select({ id: templates.id, ownerId: templates.ownerId })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(users.handle, owner), eq(templates.slug, slug)))
    .limit(1)
  if (!tpl) throw new BranchOpError('not-found')
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) {
    throw new BranchOpError('not-found') // не раскрываем существование чужих приватных
  }
}

/** Код ошибки → человекочитаемо на месте вызова (клиент знает lang). */
export type BranchActionResult = { ok: true } | { ok: false; code: BranchOpError['code'] }

export async function createBranchAction(owner: string, slug: string, name: string, from?: string): Promise<BranchActionResult> {
  try {
    await requireManage(owner, slug)
    await gitCore.createBranch({ owner, slug }, name.trim(), from)
  } catch (e) {
    return { ok: false, code: e instanceof BranchOpError ? e.code : 'internal' }
  }
  revalidatePath(`/${owner}/${slug}`)
  // Сразу переносим на созданную ветку.
  redirect(`/${owner}/${slug}?ref=${encodeURIComponent(name.trim())}`)
}

export async function deleteBranchAction(owner: string, slug: string, name: string): Promise<BranchActionResult> {
  try {
    await requireManage(owner, slug)
    await gitCore.deleteBranch({ owner, slug }, name)
  } catch (e) {
    return { ok: false, code: e instanceof BranchOpError ? e.code : 'internal' }
  }
  revalidatePath(`/${owner}/${slug}`)
  return { ok: true }
}
