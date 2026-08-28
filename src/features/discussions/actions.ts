'use server'

import { and, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, discussionComments, discussions } from '@/shared/db'
import { resolveListBySlug } from '@/shared/db/resolve-list'
import { requireSession } from '@/shared/auth/session'
import { canWriteToFeature } from '@/core'
import { ensureWatch } from '@/features/watch/actions'
import { isCategory } from './constants'

/** Открыть тред. Любой залогиненный, кто видит список, — пока раздел включён. */
/**
 * Отказ ввода — ЗНАЧЕНИЕМ, а не адресом `?e=`.
 *
 * Тот же способ, что у формы списка и формы релиза (#832): переход начинал новый GET и
 * стирал тело обсуждения вместе с заголовком.
 *
 * ⚠️ Здесь это УНИФИКАЦИЯ, а не починка наблюдаемой потери. Живая проверка показала, что
 * через браузер эта ветка недостижима: у заголовка стоит `required`, и без JS форму не
 * отправляет сам браузер, а с JS не пускает проверка на клиенте. Ветка остаётся
 * страховкой на прямой POST (сохранённая форма, чужой клиент) — и теперь отказывает так
 * же, как остальные, вместо перехода, который в том случае увёл бы неизвестно куда.
 *
 * Отказы ПРАВА (нет списка, раздел выключен) остаются переходом: это не ошибка ввода,
 * и возвращать человека в форму, которой ему нельзя пользоваться, незачем.
 */
export type DiscussionRefusal = 'empty'

export async function createDiscussion(
  _prev: DiscussionRefusal | null,
  formData: FormData,
): Promise<DiscussionRefusal | null> {
  const session = await requireSession()
  const owner = String(formData.get('owner') ?? '')
  const slug = String(formData.get('slug') ?? '')
  const title = String(formData.get('title') ?? '').trim().slice(0, 200)
  const body = String(formData.get('body') ?? '').trim().slice(0, 20000)
  const catRaw = String(formData.get('category') ?? 'general')
  const category = isCategory(catRaw) ? catRaw : 'general'
  if (!title) return 'empty'

  const tpl = await resolveListBySlug(owner, slug)
  if (!tpl) redirect(`/${owner}/${slug}`)
  // Право писать = раздел включён И список виден. Проверка на СТРАНИЦЕ отвечает только
  // за то, что видно: сохранённая форма и прямой вызов server action её не проходят, и
  // выключенный владельцем раздел продолжал принимать записи в невидимые треды.
  if (!canWriteToFeature(tpl, 'discussions', { isOwner: tpl.ownerId === session.userId })) redirect(`/${owner}/${slug}`)

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

/** Ответить в тред. Любой залогиненный, кто видит список, — пока раздел включён. */
export async function addDiscussionComment(formData: FormData): Promise<void> {
  const session = await requireSession()
  const owner = String(formData.get('owner') ?? '')
  const slug = String(formData.get('slug') ?? '')
  const number = Number(formData.get('number') ?? 0)
  const body = String(formData.get('body') ?? '').trim().slice(0, 20000)
  if (!body) redirect(`/${owner}/${slug}/discussions/${number}`)

  const tpl = await resolveListBySlug(owner, slug)
  if (!tpl) redirect(`/${owner}/${slug}`)
  if (!canWriteToFeature(tpl, 'discussions', { isOwner: tpl.ownerId === session.userId })) redirect(`/${owner}/${slug}`)

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
