'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, issueAssignees, issues, templates, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { isCollaborator } from '@/features/collab/queries'
import { notify, notifyMany, notifyMentions } from '@/features/notifications/notify'
import { ensureWatch } from '@/features/watch/actions'
import { getWatcherIds } from '@/features/watch/queries'
import { collabStore, issueCommenterIds } from '@/features/collab-store/adapter'
import { isLabelKey } from './labels'

async function resolveTemplate(owner: string, slug: string) {
  const [row] = await db
    .select({
      id: templates.id,
      ownerId: templates.ownerId,
      visibility: templates.visibility,
      moderation: templates.moderation,
    })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(users.handle, owner), eq(templates.slug, slug)))
    .limit(1)
  return row ?? null
}

const cleanLabels = (raw: string[]) => [...new Set(raw.filter(isLabelKey))]

/** Открыть issue. Любой залогиненный на публичном списке; на приватном — только владелец. */
export async function createIssue(formData: FormData): Promise<void> {
  const session = await requireSession()
  const owner = String(formData.get('owner') ?? '')
  const slug = String(formData.get('slug') ?? '')
  const title = String(formData.get('title') ?? '').trim().slice(0, 200)
  const body = String(formData.get('body') ?? '').trim().slice(0, 20000)
  const labels = cleanLabels(formData.getAll('labels').map(String))
  if (!title) redirect(`/${owner}/${slug}/issues/new?e=empty`)

  const tpl = await resolveTemplate(owner, slug)
  if (!tpl) redirect(`/${owner}/${slug}`)
  const isOwner = tpl.ownerId === session.userId
  if (tpl.visibility === 'private' && !isOwner) redirect(`/${owner}/${slug}`)
  if (tpl.moderation !== 'active' && !isOwner) redirect(`/${owner}/${slug}`)

  const ins = await collabStore.openIssue(tpl.id, session.userId, title, body, labels)

  await ensureWatch(session.userId, tpl.id) // автор issue следит за списком
  const watchers = await getWatcherIds(tpl.id)
  await notifyMany([tpl.ownerId, ...watchers], { actorId: session.userId, type: 'issue_new', templateId: tpl.id })
  await notifyMentions({ text: `${title}\n${body}`, actorId: session.userId, templateId: tpl.id, issueId: ins.id })
  revalidatePath(`/${owner}/${slug}/issues`)
  redirect(`/${owner}/${slug}/issues/${ins.number}`)
}

async function loadIssue(owner: string, slug: string, number: number) {
  const tpl = await resolveTemplate(owner, slug)
  if (!tpl) return null
  const [iss] = await db
    .select({ id: issues.id, authorId: issues.authorId, status: issues.status })
    .from(issues)
    .where(and(eq(issues.templateId, tpl.id), eq(issues.number, number)))
    .limit(1)
  if (!iss) return null
  return { tpl, iss }
}

export async function addIssueComment(formData: FormData): Promise<void> {
  const session = await requireSession()
  const owner = String(formData.get('owner') ?? '')
  const slug = String(formData.get('slug') ?? '')
  const number = Number(formData.get('number') ?? 0)
  const body = String(formData.get('body') ?? '').trim().slice(0, 20000)
  const path = `/${owner}/${slug}/issues/${number}`
  if (!body) redirect(path)

  const loaded = await loadIssue(owner, slug, number)
  if (!loaded) redirect(`/${owner}/${slug}`)
  const { tpl, iss } = loaded

  await collabStore.addIssueComment(iss.id, session.userId, body)
  await ensureWatch(session.userId, tpl.id) // комментатор начинает следить

  // Участники: автор issue + владелец + прежние комментаторы + наблюдатели.
  const commenters = await issueCommenterIds(iss.id)
  const watchers = await getWatcherIds(tpl.id)
  const recipients = [iss.authorId, tpl.ownerId, ...commenters, ...watchers]
  await notifyMany(recipients, { actorId: session.userId, type: 'issue_comment', templateId: tpl.id, issueId: iss.id })
  await notifyMentions({ text: body, actorId: session.userId, templateId: tpl.id, issueId: iss.id })

  revalidatePath(path)
  redirect(path)
}

/** Закрыть/переоткрыть issue — автор issue или владелец списка. */
export async function setIssueStatus(owner: string, slug: string, number: number, status: 'open' | 'closed'): Promise<void> {
  const session = await requireSession()
  const loaded = await loadIssue(owner, slug, number)
  if (!loaded) redirect(`/${owner}/${slug}`)
  const { tpl, iss } = loaded
  if (session.userId !== iss.authorId && session.userId !== tpl.ownerId) redirect(`/${owner}/${slug}/issues/${number}`)
  await collabStore.setIssueStatus(iss.id, status)
  revalidatePath(`/${owner}/${slug}/issues/${number}`)
  revalidatePath(`/${owner}/${slug}/issues`)
}

/** Изменить метки issue — только владелец списка. */
export async function setIssueLabels(owner: string, slug: string, number: number, labels: string[]): Promise<void> {
  const session = await requireSession()
  const loaded = await loadIssue(owner, slug, number)
  if (!loaded) redirect(`/${owner}/${slug}`)
  const { tpl, iss } = loaded
  if (session.userId !== tpl.ownerId) redirect(`/${owner}/${slug}/issues/${number}`)
  await db.update(issues).set({ labels: cleanLabels(labels), updatedAt: new Date() }).where(eq(issues.id, iss.id))
  revalidatePath(`/${owner}/${slug}/issues/${number}`)
}

/** Назначить/снять исполнителя по handle (владелец или коллаборатор). */
export async function toggleIssueAssignee(owner: string, slug: string, number: number, handle: string): Promise<void> {
  const session = await requireSession()
  const loaded = await loadIssue(owner, slug, number)
  if (!loaded) redirect(`/${owner}/${slug}`)
  const { tpl, iss } = loaded
  const canAssign = session.userId === tpl.ownerId || (await isCollaborator(tpl.id, session.userId))
  if (!canAssign) redirect(`/${owner}/${slug}/issues/${number}`)

  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.handle, handle)).limit(1)
  if (!u) return
  const userId = u.id
  const [existing] = await db
    .select({ id: issueAssignees.id })
    .from(issueAssignees)
    .where(and(eq(issueAssignees.issueId, iss.id), eq(issueAssignees.userId, userId)))
    .limit(1)
  if (existing) {
    await db.delete(issueAssignees).where(eq(issueAssignees.id, existing.id))
  } else {
    await db.insert(issueAssignees).values({ issueId: iss.id, userId })
    await notify({ recipientId: userId, actorId: session.userId, type: 'assigned', templateId: tpl.id, issueId: iss.id })
  }
  revalidatePath(`/${owner}/${slug}/issues/${number}`)
}
