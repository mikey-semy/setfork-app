'use server'

import { and, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, discussionComments, discussions } from '@/shared/db'
import { resolveListBySlug, type ResolvedList } from '@/shared/db/resolve-list'
import { requireSession } from '@/shared/auth/session'
import { canWriteToFeature } from '@/core'
import { ensureWatch } from '@/features/watch/actions'
/* eslint-disable boundaries/dependencies -- обсуждение живёт на стыке: права даёт collab,
   уведомления — notifications, подписчиков — watch, собеседников — collab-store. Тот же
   кросс-фичевый набор, что у задач. */
import { isCollaborator } from '@/features/collab/queries'
import { notifyMany, notifyMentions } from '@/features/notifications/notify'
import { getWatcherIds } from '@/features/watch/queries'
import { discussionCommenterIds } from '@/features/collab-store/store'
/* eslint-enable boundaries/dependencies */
import { canOpenDiscussion, canReplyInDiscussion } from './limits'
import { isCategory } from './constants'

/**
 * ПРАВО ПИСАТЬ В ОБСУЖДЕНИЯ — включая СОАВТОРА.
 *
 * Раньше спрашивали только «владелец ли ты», и на приватном списке соавтор оказывался в
 * положении, которое не выражает ничего осмысленного: обсуждения он ВИДИТ, а ответить не
 * может — вкладка открыта, форма на месте, запись отклоняется. Список ведут вместе, а
 * разговаривать о нём разрешено одному. Ровно этот перекос уже чинили у задач (#582).
 *
 * Соавторство спрашиваем лениво: за публичный список лишним запросом не платим.
 */
async function canWriteDiscussions(tpl: ResolvedList, userId: string): Promise<boolean> {
  const isOwner = tpl.ownerId === userId
  return (
    canWriteToFeature(tpl, 'discussions', { isOwner }) ||
    canWriteToFeature(tpl, 'discussions', { isOwner, isCollaborator: await isCollaborator(tpl.id, userId) })
  )
}

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
  // Право писать = раздел включён И список виден (соавтор — «свой», см. выше). Проверка
  // на СТРАНИЦЕ отвечает только за то, что видно: сохранённая форма и прямой вызов
  // server action её не проходят, и выключенный владельцем раздел продолжал принимать
  // записи в невидимые треды.
  if (!(await canWriteDiscussions(tpl, session.userId))) redirect(`/${owner}/${slug}`)

  // ⚠️ ЧАСТОТА — ПОСЛЕ ПРАВ, НО ДО ЗАПИСИ. Счётчика тут не было вовсе: скрипт в цикле
  // набивал ленту обсуждений за минуту. Ключей два, на человека и на список (числа и
  // довод — в ./limits).
  if (!(await canOpenDiscussion(session.userId, tpl.id))) redirect(`/${owner}/${slug}/discussions?e=rate`)

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
    .returning({ id: discussions.id, number: discussions.number })

  await ensureWatch(tpl.id) // автор треда следит за списком

  // ⚠️ О НОВОМ ОБСУЖДЕНИИ УЗНАЮТ ЛЮДИ. Раньше не узнавал никто: тред появлялся в
  // разделе и лежал там, пока владелец случайно не заглянет. Для раздела, смысл
  // которого — разговор, это отменяет сам разговор: спросить было можно, услышать —
  // нет. Круг тот же, что у новой задачи: владелец списка и наблюдатели, выбравшие
  // событие «обсуждения». Себе не шлём — `notifyMany` отсекает автора действия.
  const watchers = await getWatcherIds(tpl.id, 'discussions')
  await notifyMany([tpl.ownerId, ...watchers], {
    actorId: session.userId,
    type: 'discussion_new',
    templateId: tpl.id,
    discussionId: row.id,
  })
  await notifyMentions({
    text: `${title}\n${body}`,
    actorId: session.userId,
    templateId: tpl.id,
    discussionId: row.id,
  })

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
  if (!(await canWriteDiscussions(tpl, session.userId))) redirect(`/${owner}/${slug}`)

  const [disc] = await db
    .select({ id: discussions.id, authorId: discussions.authorId })
    .from(discussions)
    .where(and(eq(discussions.templateId, tpl.id), eq(discussions.number, number)))
    .limit(1)
  if (!disc) redirect(`/${owner}/${slug}/discussions`)

  // ⚠️ ЧАСТОТА СЧИТАЕТСЯ ПОСЛЕ ТОГО, КАК ТРЕД НАЙДЕН. Иначе перебор несуществующих
  // номеров жёг бы счётчик СПИСКА, ничего не записав, — то есть любой желающий затыкал
  // бы разговор всем остальным до конца окна. Счётчик существует ради записей и их
  // рассылки; за отказ, который ничего не записал, платить нечем. Тот же порядок у
  // задач: там реплика тоже считается после загрузки задачи.
  if (!(await canReplyInDiscussion(session.userId, tpl.id))) {
    redirect(`/${owner}/${slug}/discussions/${number}?e=rate`)
  }

  await db.insert(discussionComments).values({ discussionId: disc.id, authorId: session.userId, body })
  await ensureWatch(tpl.id)

  // Об ответе узнают ТЕ ЖЕ, кто узнаёт об ответе в задаче: автор треда, владелец списка,
  // прежние собеседники и наблюдатели раздела. Без этого разговор шёл вслепую — человек
  // отвечал, а его собеседник об ответе не знал.
  const [commenters, watchers] = await Promise.all([
    discussionCommenterIds(disc.id),
    getWatcherIds(tpl.id, 'discussions'),
  ])
  await notifyMany([disc.authorId, tpl.ownerId, ...commenters, ...watchers], {
    actorId: session.userId,
    type: 'discussion_comment',
    templateId: tpl.id,
    discussionId: disc.id,
  })
  await notifyMentions({ text: body, actorId: session.userId, templateId: tpl.id, discussionId: disc.id })

  revalidatePath(`/${owner}/${slug}/discussions/${number}`)
  redirect(`/${owner}/${slug}/discussions/${number}`)
}
