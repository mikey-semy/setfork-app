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
import { recordIssueEvent } from './events'
import { ensureWatch } from '@/features/watch/actions'
import { getWatcherIds } from '@/features/watch/queries'
import { collabStore, issueCommenterIds } from '@/features/collab-store/store'
import { loadIssue } from './queries'
// `canComment` в этом файле уже занято проверкой ПРАВ — частота именуется иначе,
// чтобы на месте вызова было видно, о чём речь.
import { canComment as underCommentRate, canOpenIssue as underIssueRate } from './limits'
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

  // ⚠️ ЧАСТОТА — ПОСЛЕ ПРАВ, НО ДО ЗАПИСИ. Каждая задача рассылает уведомления автору,
  // владельцу и наблюдателям, поэтому скрипт в цикле бьёт не только по базе. Ключей
  // два — на человека и на список (см. `limits.ts`, там же выведены числа).
  if (!(await underIssueRate(session.userId, tpl.id))) redirect(`/${owner}/${slug}/issues?e=rate`)

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

  // ⚠️ ЗАПЕРТОЕ ОБСУЖДЕНИЕ ПРОВЕРЯЕТСЯ ЗДЕСЬ, а не только пряча форму. Форма — это
  // вежливость, а не запрет: адрес действия известен, и отправить в него можно из чего
  // угодно. Пускаем тех же, кто может запирать: владельца и коллаборантов.
  if (iss.lockedAt) {
    const canManage = session.userId === tpl.ownerId || (await isCollaborator(tpl.id, session.userId))
    if (!canManage) redirect(path)
  }

  if (!(await underCommentRate(session.userId, tpl.id))) redirect(`${path}?e=rate`)

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

/**
 * Закрыть/переоткрыть issue — автор issue или владелец списка.
 *
 * ⚠️ ЗАКРЫТО — НЕ ОТВЕТ. «Сделали» и «не будем делать» выглядят одинаково (перечёркнутый
 * номер), а значат противоположное: у первого работа позади, у второго её не будет.
 * Поэтому у закрытия есть ИСХОД, отдельный от состояния, — как у всех, кого читали
 * (GitHub `IssueStateReason`, SourceHut `TicketResolution`, «statuses/resolutions» у Jira).
 *
 * Дубликат — исход И связь сразу: причина без ссылки сообщает, что оригинал есть, и не
 * говорит где. У GitHub в `CloseIssueInput` ровно та же пара — `stateReason: DUPLICATE`
 * и `duplicateIssueId`.
 */
export async function setIssueStatus(
  owner: string,
  slug: string,
  number: number,
  status: 'open' | 'closed',
  reason?: 'completed' | 'not_planned' | 'duplicate',
  /** Номер задачи-оригинала — только при `duplicate`. */
  duplicateOfNumber?: number,
): Promise<void> {
  const session = await requireSession()
  const loaded = await loadIssue(owner, slug, number)
  if (!loaded) redirect(`/${owner}/${slug}`)
  const { tpl, iss } = loaded
  if (session.userId !== iss.authorId && session.userId !== tpl.ownerId) redirect(`/${owner}/${slug}/issues/${number}`)

  // Оригинал ищем ПО НОМЕРУ и в ТОМ ЖЕ списке: чужая задача дубликатом не объявляется, и
  // ссылка на неё из другого списка читалась бы как «иди туда, где тебе нечего делать».
  let duplicateOfId: string | null = null
  if (status === 'closed' && reason === 'duplicate' && duplicateOfNumber && duplicateOfNumber !== number) {
    const [orig] = await db
      .select({ id: issues.id })
      .from(issues)
      .where(and(eq(issues.templateId, tpl.id), eq(issues.number, duplicateOfNumber)))
      .limit(1)
    duplicateOfId = orig?.id ?? null
  }

  await collabStore.setIssueStatus(iss.id, status)
  // Исход живёт, пока задача закрыта. При переоткрытии он снимается — иначе открытая
  // задача носила бы отметку «сделано». В ЛЕНТЕ он при этом остаётся навсегда: «закрыли
  // как не будем делать» — часть разговора, а не текущее состояние (та же развилка, что
  // у причины запирания).
  await db
    .update(issues)
    .set({
      closeReason: status === 'closed' ? (reason ?? null) : null,
      duplicateOfId: status === 'closed' ? duplicateOfId : null,
    })
    .where(eq(issues.id, iss.id))
  // След в ленте — сразу за статусом (о порядке см. ./events).
  await recordIssueEvent(db, {
    issueId: iss.id,
    actorId: session.userId,
    kind: status === 'closed' ? 'closed' : 'reopened',
    closeReason: status === 'closed' ? (reason ?? null) : null,
    duplicateOfId: status === 'closed' ? duplicateOfId : null,
  })

  // ⚠️ Об этом узнают ТЕ ЖЕ, кто узнаёт о новой реплике. Закрытие — не мелочь оформления:
  // для автора это ответ «вопрос снят», для следящих — «тут больше ничего не будет».
  // Раньше молчали вовсе, и человек узнавал о закрытии, случайно вернувшись на страницу.
  // Себе не шлём: `notifyMany` отсекает автора действия.
  const [commenters, watchers] = await Promise.all([issueCommenterIds(iss.id), getWatcherIds(tpl.id, 'issues')])
  await notifyMany([iss.authorId, tpl.ownerId, ...commenters, ...watchers], {
    actorId: session.userId,
    type: status === 'closed' ? 'issue_closed' : 'issue_reopened',
    templateId: tpl.id,
    issueId: iss.id,
  })

  revalidatePath(`/${owner}/${slug}/issues/${number}`)
  revalidatePath(`/${owner}/${slug}/issues`)
}

/**
 * ЗАПЕРЕТЬ ИЛИ ОТПЕРЕТЬ ОБСУЖДЕНИЕ ЗАДАЧИ — владелец списка или коллаборант.
 *
 * ⚠️ ЗАПЕРТО ≠ ЗАКРЫТО, и это не игра словами. Спор уходит в сторону и при нерешённой
 * задаче; закрывать её ради тишины значит записать «сделано» там, где не сделано. Тот же
 * довод, по которому запирание отдельно от закрытия у предложений.
 *
 * Причина — из перечня, а не свободной строкой (см. lockReasonEnum в схеме): у Gitea она
 * настраивается инстансом, и её же исходники честно называют цену — «customized reasons
 * are not translatable… we do not do validation». У нас двуязычный интерфейс и узда на
 * непереводимые строки.
 *
 * Автор задачи запереть её НЕ может, хотя закрыть — может. Закрытие — про свою задачу
 * («вопрос снят»), запирание — про чужую речь, и такое право у владельца раздела.
 */
export async function setIssueLocked(
  owner: string,
  slug: string,
  number: number,
  locked: boolean,
  reason?: 'off_topic' | 'too_heated' | 'resolved' | 'spam',
): Promise<void> {
  const session = await requireSession()
  const loaded = await loadIssue(owner, slug, number)
  if (!loaded) redirect(`/${owner}/${slug}`)
  const { tpl, iss } = loaded
  const path = `/${owner}/${slug}/issues/${number}`
  const canManage = session.userId === tpl.ownerId || (await isCollaborator(tpl.id, session.userId))
  if (!canManage) redirect(path)
  // Повтор того же состояния — не ошибка, но и записи в ленту не заслуживает: иначе
  // двойное нажатие оставляет два одинаковых следа (так же поступает Gitea).
  if (!!iss.lockedAt === locked) redirect(path)

  await db
    .update(issues)
    .set({
      lockedAt: locked ? new Date() : null,
      lockedById: locked ? session.userId : null,
      lockReason: locked ? (reason ?? null) : null,
      updatedAt: new Date(),
    })
    .where(eq(issues.id, iss.id))
  await recordIssueEvent(db, {
    issueId: iss.id,
    actorId: session.userId,
    kind: locked ? 'locked' : 'unlocked',
    lockReason: locked ? (reason ?? null) : null,
  })

  revalidatePath(path)
  revalidatePath(`/${owner}/${slug}/issues`)
  redirect(path)
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
