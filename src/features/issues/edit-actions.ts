'use server'
import { and, desc, eq, sql } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireSession } from '@/shared/auth/session'
import { contentEdits, db, issueComments, issues } from '@/shared/db'
import { loadIssue } from './queries'

/**
 * ПРАВКА ЗАДАЧИ И КОММЕНТАРИЯ — ВСЕГДА С ИСТОРИЕЙ.
 *
 * Без истории правка текста это способ переписать сказанное задним числом: в задачах
 * лежат жалобы и споры, и обвинение можно отредактировать после ответа на него. Поэтому
 * прежнее содержимое сохраняется в той же транзакции, что и новое, — иначе между двумя
 * записями есть окно, в котором правка уже произошла, а следа ещё нет.
 *
 * Так же поступают Gitea (`issue_content_history`, до 20 ревизий) и GitHub (до 100,
 * история видна всем, у кого есть доступ на чтение).
 *
 * ⚠️ ПРАВКА НЕ МЕНЯЕТ АВТОРСТВО И ВРЕМЯ СОЗДАНИЯ. Меняется только текст и `updatedAt`:
 * по нему интерфейс и показывает пометку «изменено».
 */

/** Сколько ревизий держим на один объект. */
const MAX_REVISIONS = 20

/**
 * Права: автор — всегда; владелец списка — только у задачи.
 *
 * Владелец правит чужой комментарий только в одном смысле — «переписать за человека»,
 * а это ровно то, от чего защищает история. Ему доступны скрытие и удаление списка
 * целиком; редактирования чужой реплики у него нет и у GitHub (там владелец репозитория
 * может лишь скрыть комментарий, не изменить текст).
 */
function canEditIssue(userId: string, authorId: string, ownerId: string): boolean {
  return userId === authorId || userId === ownerId
}

async function pruneHistory(kind: 'issue' | 'comment', targetId: string): Promise<void> {
  // Хвост старше двадцатой ревизии срезаем: история нужна как защита от подмены
  // недавнего, а не как вечный архив. Число взято у Gitea — у них тот же предмет
  // (задачи и комментарии), в отличие от ста у GitHub, где история ещё и в API.
  await db.execute(sql`
    delete from ${contentEdits}
    where ${contentEdits.kind} = ${kind}
      and ${contentEdits.targetId} = ${targetId}
      and ${contentEdits.id} not in (
        select id from ${contentEdits}
        where ${contentEdits.kind} = ${kind} and ${contentEdits.targetId} = ${targetId}
        order by ${contentEdits.createdAt} desc
        limit ${MAX_REVISIONS}
      )
  `)
}

/** Обёртка для `<form action>`: адрес задачи связывается на месте вызова. */
export async function editIssueForm(owner: string, slug: string, number: number, formData: FormData): Promise<void> {
  await editIssue(owner, slug, number, String(formData.get('title') ?? ''), String(formData.get('body') ?? '').slice(0, 20000))
}

/** То же для комментария: id связан, текст приходит формой. */
export async function editCommentForm(
  owner: string,
  slug: string,
  number: number,
  commentId: string,
  formData: FormData,
): Promise<void> {
  await editIssueComment(owner, slug, number, commentId, String(formData.get('body') ?? '').slice(0, 20000))
}

export async function editIssue(
  owner: string,
  slug: string,
  number: number,
  title: string,
  body: string,
): Promise<void> {
  const session = await requireSession()
  const loaded = await loadIssue(owner, slug, number)
  const path = `/${owner}/${slug}/issues/${number}`
  if (!loaded) redirect(`/${owner}/${slug}`)
  const { tpl, iss } = loaded
  if (!canEditIssue(session.userId, iss.authorId, tpl.ownerId)) redirect(path)

  const nextTitle = title.trim()
  const nextBody = body.trim()
  // Пустой заголовок не сохраняем: задача без имени неотличима в списке.
  if (!nextTitle) redirect(path)
  // Ничего не изменилось — ни записи в историю, ни отметки «изменено».
  if (nextTitle === iss.title && nextBody === (iss.body ?? '')) redirect(path)

  await db.transaction(async (tx) => {
    await tx.insert(contentEdits).values({
      kind: 'issue',
      targetId: iss.id,
      editorId: session.userId,
      prevTitle: iss.title,
      prevBody: iss.body ?? '',
    })
    await tx.update(issues).set({ title: nextTitle, body: nextBody, updatedAt: new Date() }).where(eq(issues.id, iss.id))
  })
  await pruneHistory('issue', iss.id)

  revalidatePath(path)
  revalidatePath(`/${owner}/${slug}/issues`)
  redirect(path)
}

export async function editIssueComment(
  owner: string,
  slug: string,
  number: number,
  commentId: string,
  body: string,
): Promise<void> {
  const session = await requireSession()
  const loaded = await loadIssue(owner, slug, number)
  const path = `/${owner}/${slug}/issues/${number}`
  if (!loaded) redirect(`/${owner}/${slug}`)
  const { iss } = loaded

  const [comment] = await db
    .select({ id: issueComments.id, authorId: issueComments.authorId, body: issueComments.body })
    .from(issueComments)
    .where(and(eq(issueComments.id, commentId), eq(issueComments.issueId, iss.id)))
    .limit(1)
  // Чужой комментарий правит только его автор — см. комментарий к `canEditIssue`.
  if (!comment || comment.authorId !== session.userId) redirect(path)

  const nextBody = body.trim()
  if (!nextBody || nextBody === comment.body) redirect(path)

  await db.transaction(async (tx) => {
    await tx.insert(contentEdits).values({
      kind: 'comment',
      targetId: comment.id,
      editorId: session.userId,
      prevBody: comment.body,
    })
    await tx
      .update(issueComments)
      .set({ body: nextBody, updatedAt: new Date() })
      .where(eq(issueComments.id, comment.id))
  })
  await pruneHistory('comment', comment.id)

  revalidatePath(path)
  redirect(path)
}

export type ContentRevision = { id: string; editorId: string; prevTitle: string | null; prevBody: string; createdAt: Date }

/** История правок объекта, свежие сверху. Видна всем, кто видит саму задачу. */
export async function contentHistory(kind: 'issue' | 'comment', targetId: string): Promise<ContentRevision[]> {
  return db
    .select({
      id: contentEdits.id,
      editorId: contentEdits.editorId,
      prevTitle: contentEdits.prevTitle,
      prevBody: contentEdits.prevBody,
      createdAt: contentEdits.createdAt,
    })
    .from(contentEdits)
    .where(and(eq(contentEdits.kind, kind), eq(contentEdits.targetId, targetId)))
    .orderBy(desc(contentEdits.createdAt))
    .limit(MAX_REVISIONS)
}
