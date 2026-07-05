'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, releases, templates, templateVersions, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { isCollaborator } from '@/features/collab/queries'

const TAG_RE = /^[A-Za-z0-9._-]{1,40}$/

async function handleOf(userId: string): Promise<string> {
  const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1)
  return u?.handle ?? ''
}

/** Владелец/коллаборатор: опубликовать релиз из версии. */
export async function createRelease(templateId: string, formData: FormData): Promise<void> {
  const session = await requireSession()
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, templateId) })
  if (!tpl) return
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return

  const owner = await handleOf(tpl.ownerId)
  const base = `/${owner}/${tpl.slug}/releases`
  const version = Number(formData.get('version') ?? tpl.currentVersion)
  const tag = String(formData.get('tag') ?? '').trim() || `v${version}`
  const title = String(formData.get('title') ?? '').trim().slice(0, 200)
  const notes = String(formData.get('notes') ?? '').trim().slice(0, 50000)

  if (!TAG_RE.test(tag)) redirect(`${base}/new?e=badtag`)
  // Версия должна существовать.
  const [v] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, tpl.id), eq(templateVersions.version, version)))
    .limit(1)
  if (!v) redirect(`${base}/new?e=badversion`)
  // Тег уникален per-list.
  const [dup] = await db
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.templateId, tpl.id), eq(releases.tag, tag)))
    .limit(1)
  if (dup) redirect(`${base}/new?e=tagtaken`)

  await db.insert(releases).values({ templateId: tpl.id, version, tag, title, notes, authorId: session.userId })
  // Git-тег релиза на коммит версии (best-effort): чтобы clone привозил и
  // человекочитаемый тег, а не только авто-vN. Ошибку git не роняем на релиз.
  const { gitCore } = await import('@/features/git/core')
  await gitCore.createTag({ owner, slug: tpl.slug }, tag, version).catch(() => {})
  revalidatePath(base)
  redirect(base)
}

/** Владелец/коллаборатор: удалить релиз (сам список/версии не трогаем). */
export async function deleteRelease(releaseId: string): Promise<void> {
  const session = await requireSession()
  const rel = await db.query.releases.findFirst({ where: (r) => eq(r.id, releaseId) })
  if (!rel) return
  const tpl = await db.query.templates.findFirst({ where: (t) => eq(t.id, rel.templateId) })
  if (!tpl) return
  if (tpl.ownerId !== session.userId && !(await isCollaborator(tpl.id, session.userId))) return
  await db.delete(releases).where(eq(releases.id, releaseId))
  const owner = await handleOf(tpl.ownerId)
  revalidatePath(`/${owner}/${tpl.slug}/releases`)
}
