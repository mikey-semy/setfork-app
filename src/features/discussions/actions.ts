'use server'

import { and, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, discussionComments, discussions } from '@/shared/db'
import { resolveListBySlug } from '@/shared/db/resolve-list'
import { requireSession } from '@/shared/auth/session'
import { canViewList } from '@/core'
import { ensureWatch } from '@/features/watch/actions'
import { isCategory } from './constants'

/** Открыть тред. Любой залогиненный, кто видит список. */
export async function createDiscussion(formData: FormData): Promise<void> {
  const session = await requireSession()
  const owner = String(formData.get('owner') ?? '')
  const slug = String(formData.get('slug') ?? '')
  const title = String(formData.get('title') ?? '').trim().slice(0, 200)
  const body = String(formData.get('body') ?? '').trim().slice(0, 20000)
  const catRaw = String(formData.get('category') ?? 'general')
  const category = isCategory(catRaw) ? catRaw : 'general'
  if (!title) redirect(`/${owner}/${slug}/discussions/new?e=empty`)

  const tpl = await resolveListBySlug(owner, slug)
  if (!tpl) redirect(`/${owner}/${slug}`)
  if (!canViewList(tpl, { isOwner: tpl.ownerId === session.userId })) redirect(`/${owner}/${slug}`)

  // Номер per-list — подзапросом в одном INSERT (атомарно; гонку добьёт unique).
  const [row] = await db
    .insert(discussions)
    .values({
      templateId: tpl.id,
      authorId: session.userId,
      title,
      body,
      category,
      number: sql<number>`(select coalesce(max(${discussions.number}), 0) + 1 from ${discussions} where ${discussions.templateId} = ${tpl.id})`,
    })
    .returning({ number: discussions.number })

  await ensureWatch(tpl.id) // автор треда следит за списком
  revalidatePath(`/${owner}/${slug}/discussions`)
  redirect(`/${owner}/${slug}/discussions/${row.number}`)
}

/** Ответить в тред. Любой залогиненный, кто видит список. */
export async function addDiscussionComment(formData: FormData): Promise<void> {
  const session = await requireSession()
  const owner = String(formData.get('owner') ?? '')
  const slug = String(formData.get('slug') ?? '')
  const number = Number(formData.get('number') ?? 0)
  const body = String(formData.get('body') ?? '').trim().slice(0, 20000)
  if (!body) redirect(`/${owner}/${slug}/discussions/${number}`)

  const tpl = await resolveListBySlug(owner, slug)
  if (!tpl) redirect(`/${owner}/${slug}`)
  if (!canViewList(tpl, { isOwner: tpl.ownerId === session.userId })) redirect(`/${owner}/${slug}`)

  const [disc] = await db
    .select({ id: discussions.id })
    .from(discussions)
    .where(and(eq(discussions.templateId, tpl.id), eq(discussions.number, number)))
    .limit(1)
  if (!disc) redirect(`/${owner}/${slug}/discussions`)

  await db.insert(discussionComments).values({ discussionId: disc.id, authorId: session.userId, body })
  await ensureWatch(tpl.id)
  revalidatePath(`/${owner}/${slug}/discussions/${number}`)
  redirect(`/${owner}/${slug}/discussions/${number}`)
}
