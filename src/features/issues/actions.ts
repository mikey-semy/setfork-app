'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { councilExperts, db, issueAssignees, issues, users } from '@/shared/db'
import { enqueueJob } from '@/shared/jobs/queue'
import { getLang } from '@/shared/i18n/server'
import { requireSession } from '@/shared/auth/session'
import { isCollaborator } from '@/features/collab/queries'
import { notify } from '@/features/notifications/notify'
import { recordIssueEvent } from './events'
import { changeIssueStatus, commentOnIssue, openIssue } from './core'
import { cleanLabels } from '@/shared/lib/labels'
import { getListLabels, loadIssue, type CloseReason } from './queries'

const customIdSet = async (templateId: string) => new Set((await getListLabels(templateId)).map((l) => l.id))

/**
 * ФОРМА «НОВЫЙ ВОПРОС» — сессия, ворота из ./core, переход.
 *
 * Сами ворота (право писать в раздел, частота, уведомления) живут в ядре: у задач
 * теперь две поверхности, сайт и MCP, и вторая копия правил разошлась бы с первой.
 * Здесь остаётся только то, чего у MCP нет: cookie-сессия, обновление кэша страниц и
 * адрес, куда отправить браузер.
 *
 * Отказ ввода — ЗНАЧЕНИЕМ, а не адресом `?e=`. Форма проверяет заголовок на клиенте, и
 * туда переход не доходил. Проверено живьём: без JS ветка тоже недостижима — `required`
 * не даёт браузеру отправить форму. Значит это УНИФИКАЦИЯ, а не починка наблюдаемой
 * потери: ветка остаётся страховкой на прямой POST и теперь отказывает так же, как
 * остальные формы (#832), вместо перехода.
 */
export type IssueRefusal = 'empty'

export async function createIssue(_prev: IssueRefusal | null, formData: FormData): Promise<IssueRefusal | null> {
  const session = await requireSession()
  const owner = String(formData.get('owner') ?? '')
  const slug = String(formData.get('slug') ?? '')
  const res = await openIssue(session.userId, owner, slug, {
    title: String(formData.get('title') ?? ''),
    body: String(formData.get('body') ?? ''),
    labels: formData.getAll('labels').map(String),
  })
  if (!res.ok) {
    if (res.reason === 'empty') return 'empty'
    if (res.reason === 'rate') redirect(`/${owner}/${slug}/issues?e=rate`)
    redirect(`/${owner}/${slug}`)
  }
  revalidatePath(`/${owner}/${slug}/issues`)
  redirect(`/${owner}/${slug}/issues/${res.number}`)
}


export async function addIssueComment(formData: FormData): Promise<void> {
  const session = await requireSession()
  const owner = String(formData.get('owner') ?? '')
  const slug = String(formData.get('slug') ?? '')
  const number = Number(formData.get('number') ?? 0)
  const path = `/${owner}/${slug}/issues/${number}`

  const res = await commentOnIssue(session.userId, owner, slug, number, String(formData.get('body') ?? ''))
  if (!res.ok) {
    if (res.reason === 'rate') redirect(`${path}?e=rate`)
    // «Нет списка» и «нет прав» уводят на список: страницы задачи для этого человека
    // не существует. «Пусто» и «заперто» — обратно в тред, там видно почему.
    if (res.reason === 'not_found' || res.reason === 'forbidden') redirect(`/${owner}/${slug}`)
    redirect(path)
  }

  revalidatePath(path)
  redirect(path)
}

/**
 * Закрыть/переоткрыть задачу — правила в ./core, здесь сессия и переход.
 */
export async function setIssueStatus(
  owner: string,
  slug: string,
  number: number,
  status: 'open' | 'closed',
  reason?: CloseReason,
  /** Номер задачи-оригинала — только при `duplicate`. */
  duplicateOfNumber?: number,
): Promise<void> {
  const session = await requireSession()
  const path = `/${owner}/${slug}/issues/${number}`
  const res = await changeIssueStatus(session.userId, owner, slug, number, status, reason, duplicateOfNumber)
  if (!res.ok) {
    if (res.reason === 'not_found') redirect(`/${owner}/${slug}`)
    // Номер оригинала назвали, а такой задачи в списке нет: молчать нельзя — человек
    // уверен, что поставил ссылку, а её бы не было.
    if (res.reason === 'duplicate_not_found') redirect(`${path}?e=dup`)
    redirect(path)
  }

  revalidatePath(path)
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
