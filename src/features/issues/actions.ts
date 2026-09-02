'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { councilExperts, db, issueAssignees, issues, users } from '@/shared/db'
import { enqueueJob } from '@/shared/jobs/queue'
import { getLang } from '@/shared/i18n/server'
import { resolveListBySlug } from '@/shared/db/resolve-list'
import { requireSession } from '@/shared/auth/session'
import { canWriteToFeature, isFeatureEnabled } from '@/core'
import { isCollaborator } from '@/features/collab/queries'
import { notify, notifyMany, notifyMentions } from '@/features/notifications/notify'
import { ensureWatch } from '@/features/watch/actions'
import { getWatcherIds } from '@/features/watch/queries'
import { collabStore, issueCommenterIds } from '@/features/collab-store/store'
import { loadIssue } from './queries'
import { cleanLabels, customId, isCustomKey, isLabelKey } from '@/shared/lib/labels'
import { getListLabels } from './queries'

const customIdSet = async (templateId: string) => new Set((await getListLabels(templateId)).map((l) => l.id))

/** Открыть issue. Любой залогиненный на видимом списке; приватный/черновик/снятый
 *  модерацией — владелец и коллабораторы (те, кто список и так видит). */
/**
 * Отказ ввода — ЗНАЧЕНИЕМ, а не адресом `?e=`.
 *
 * Форма проверяет заголовок на клиенте, и туда переход не доходил. Проверено живьём:
 * без JS ветка тоже недостижима — `required` не даёт браузеру отправить форму. Значит
 * это УНИФИКАЦИЯ, а не починка наблюдаемой потери: ветка остаётся страховкой на прямой
 * POST и теперь отказывает так же, как остальные формы (#832), вместо перехода.
 */
export type IssueRefusal = 'empty'

export async function createIssue(_prev: IssueRefusal | null, formData: FormData): Promise<IssueRefusal | null> {
  const session = await requireSession()
  const owner = String(formData.get('owner') ?? '')
  const slug = String(formData.get('slug') ?? '')
  const title = String(formData.get('title') ?? '').trim().slice(0, 200)
  const body = String(formData.get('body') ?? '').trim().slice(0, 20000)
  const rawLabels = formData.getAll('labels').map(String)
  if (!title) return 'empty'

  const tpl = await resolveListBySlug(owner, slug)
  if (!tpl) redirect(`/${owner}/${slug}`)
  // Единый предикат, а не своя пара проверок: копия здесь забывала про ЧЕРНОВИК —
  // посторонний открывал задачу в чужом неопубликованном списке (слаг предсказуем по
  // заголовку), владельцу летело уведомление, notifyMentions рассылал упоминания
  // (линза 02, F4). Заодно уходит перекос: коллаборатор приватного списка, который
  // список видит, теперь может завести в нём задачу.
  // Раздел, выключенный владельцем, тоже проверяется ЗДЕСЬ, а не только на странице:
  // сохранённая форма и прямой вызов action страницу не проходят, и задачи заводились
  // в списке, где раздел «Вопросы» отключён и не показывается никому.
  const isOwner = tpl.ownerId === session.userId
  const canWrite =
    canWriteToFeature(tpl, 'issues', { isOwner }) ||
    canWriteToFeature(tpl, 'issues', { isOwner, isCollaborator: await isCollaborator(tpl.id, session.userId) })
  if (!canWrite) redirect(`/${owner}/${slug}`)

  const labels = cleanLabels(rawLabels, await customIdSet(tpl.id))
  const ins = await collabStore.openIssue(tpl.id, session.userId, title, body, labels)

  await ensureWatch(tpl.id) // автор issue следит за списком
  const watchers = await getWatcherIds(tpl.id, 'issues')
  await notifyMany([tpl.ownerId, ...watchers], { actorId: session.userId, type: 'issue_new', templateId: tpl.id })
  await notifyMentions({ text: `${title}\n${body}`, actorId: session.userId, templateId: tpl.id, issueId: ins.id })
  revalidatePath(`/${owner}/${slug}/issues`)
  redirect(`/${owner}/${slug}/issues/${ins.number}`)
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
  // Комментарий — запись в тред списка: нельзя к issue приватного/скрытого/черновика
  // (иначе инъекция в приватную ветку + пинги владельцу + оракул по перебору номеров).
  // Коллаборатор проходит так же, как при СОЗДАНИИ задачи выше: иначе он открывал бы
  // задачу в приватном списке, видел форму ответа и не мог отправить ни одного
  // комментария — тред, доступный только на запись первой строки (P2 авто-ревью #582).
  const isOwnerC = tpl.ownerId === session.userId
  const canComment =
    canWriteToFeature(tpl, 'issues', { isOwner: isOwnerC }) ||
    canWriteToFeature(tpl, 'issues', { isOwner: isOwnerC, isCollaborator: await isCollaborator(tpl.id, session.userId) })
  if (!canComment) redirect(`/${owner}/${slug}`)

  await collabStore.addIssueComment(iss.id, session.userId, body)
  await ensureWatch(tpl.id) // комментатор начинает следить

  // Участники: автор issue + владелец + прежние комментаторы + наблюдатели.
  const [commenters, watchers] = await Promise.all([issueCommenterIds(iss.id), getWatcherIds(tpl.id, 'issues')])
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

/** Изменить метки issue — владелец списка ИЛИ коллаборатор (как assignees/milestones). */
export async function setIssueLabels(owner: string, slug: string, number: number, labels: string[]): Promise<void> {
  const session = await requireSession()
  const loaded = await loadIssue(owner, slug, number)
  if (!loaded) redirect(`/${owner}/${slug}`)
  const { tpl, iss } = loaded
  const canManage = session.userId === tpl.ownerId || (await isCollaborator(tpl.id, session.userId))
  if (!canManage) redirect(`/${owner}/${slug}/issues/${number}`)
  const cleaned = cleanLabels(labels, await customIdSet(tpl.id))
  await db.update(issues).set({ labels: cleaned, updatedAt: new Date() }).where(eq(issues.id, iss.id))
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
    // Назначили ГНОМА — он и правда возьмётся: ставим задачу, предложение придёт
    // фоном. Гномы у нас настоящие пользователи, поэтому назначение — обычное,
    // и никакой отдельной «панели агентов» для этого не нужно.
    const [expert] = await db.select({ id: councilExperts.id }).from(councilExperts).where(eq(councilExperts.userId, userId)).limit(1)
    if (expert) {
      await enqueueJob('gnome_task', { issueId: iss.id, expertId: expert.id, lang: await getLang() }).catch(() => {})
    }
  }
  revalidatePath(`/${owner}/${slug}/issues/${number}`)
}
