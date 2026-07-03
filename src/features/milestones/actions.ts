'use server'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, issues, milestones, templates, users } from '@/shared/db'
import { requireSession } from '@/shared/auth/session'
import { isCollaborator } from '@/features/collab/queries'

async function resolveTpl(owner: string, slug: string) {
  const [row] = await db
    .select({ id: templates.id, ownerId: templates.ownerId })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(users.handle, owner), eq(templates.slug, slug)))
    .limit(1)
  return row ?? null
}

async function canManage(userId: string, tplId: string, ownerId: string) {
  return userId === ownerId || (await isCollaborator(tplId, userId))
}

/** Создать веху (владелец/коллаборатор). */
export async function createMilestone(formData: FormData): Promise<void> {
  const session = await requireSession()
  const owner = String(formData.get('owner') ?? '')
  const slug = String(formData.get('slug') ?? '')
  const title = String(formData.get('title') ?? '').trim().slice(0, 120)
  const desc = String(formData.get('desc') ?? '').trim().slice(0, 2000)
  const dueStr = String(formData.get('dueOn') ?? '').trim()
  const tpl = await resolveTpl(owner, slug)
  if (!tpl) redirect(`/${owner}/${slug}`)
  if (!(await canManage(session.userId, tpl.id, tpl.ownerId))) redirect(`/${owner}/${slug}/milestones`)
  const base = `/${owner}/${slug}/milestones`
  if (!title) redirect(`${base}?e=empty`)
  const due = dueStr ? new Date(dueStr) : null
  await db.insert(milestones).values({ templateId: tpl.id, title, desc, dueOn: due && !Number.isNaN(+due) ? due : null })
  revalidatePath(base)
  redirect(base)
}

/** Открыть/закрыть веху. */
export async function toggleMilestoneClosed(owner: string, slug: string, id: string): Promise<void> {
  const session = await requireSession()
  const tpl = await resolveTpl(owner, slug)
  if (!tpl) redirect(`/${owner}/${slug}`)
  if (!(await canManage(session.userId, tpl.id, tpl.ownerId))) redirect(`/${owner}/${slug}/milestones`)
  const [m] = await db.select({ closed: milestones.closed }).from(milestones).where(and(eq(milestones.id, id), eq(milestones.templateId, tpl.id))).limit(1)
  if (!m) return
  await db.update(milestones).set({ closed: !m.closed }).where(eq(milestones.id, id))
  revalidatePath(`/${owner}/${slug}/milestones`)
}

/** Удалить веху (issue отвязываются автоматически через ON DELETE SET NULL). */
export async function deleteMilestone(owner: string, slug: string, id: string): Promise<void> {
  const session = await requireSession()
  const tpl = await resolveTpl(owner, slug)
  if (!tpl) redirect(`/${owner}/${slug}`)
  if (!(await canManage(session.userId, tpl.id, tpl.ownerId))) redirect(`/${owner}/${slug}/milestones`)
  await db.delete(milestones).where(and(eq(milestones.id, id), eq(milestones.templateId, tpl.id)))
  revalidatePath(`/${owner}/${slug}/milestones`)
}

/** Назначить/снять веху у issue (milestoneId='' → снять). */
export async function setIssueMilestone(owner: string, slug: string, number: number, milestoneId: string): Promise<void> {
  const session = await requireSession()
  const tpl = await resolveTpl(owner, slug)
  if (!tpl) redirect(`/${owner}/${slug}`)
  if (!(await canManage(session.userId, tpl.id, tpl.ownerId))) redirect(`/${owner}/${slug}/issues/${number}`)
  // валидируем веху (если задана) в рамках этого списка
  let value: string | null = null
  if (milestoneId) {
    const [m] = await db.select({ id: milestones.id }).from(milestones).where(and(eq(milestones.id, milestoneId), eq(milestones.templateId, tpl.id))).limit(1)
    if (!m) return
    value = m.id
  }
  await db.update(issues).set({ milestoneId: value, updatedAt: new Date() }).where(and(eq(issues.templateId, tpl.id), eq(issues.number, number)))
  revalidatePath(`/${owner}/${slug}/issues/${number}`)
}
