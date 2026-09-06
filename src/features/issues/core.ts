import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, issues } from '@/shared/db'
import { resolveListBySlug, type ResolvedList } from '@/shared/db/resolve-list'
import { canWriteToFeature } from '@/core'
/* eslint-disable boundaries/dependencies -- задача живёт на стыке разделов: права даёт collab,
   уведомления — notifications, подписку — watch, саму запись — collab-store. Тот же
   кросс-фичевый набор был у actions.ts, откуда эти вызовы сюда и переехали. */
import { isCollaborator } from '@/features/collab/queries'
import { notifyMany, notifyMentions } from '@/features/notifications/notify'
import { subscribeToList } from '@/features/watch/subscribe'
import { getWatcherIds } from '@/features/watch/queries'
import { collabStore, issueCommenterIds } from '@/features/collab-store/store'
/* eslint-enable boundaries/dependencies */
import { cleanLabels } from '@/shared/lib/labels'
import { getListLabels, loadIssue, type CloseReason } from './queries'
import { recordIssueEvent } from './events'
// `canComment` здесь занято проверкой ПРАВ — частота именуется иначе, чтобы на месте
// вызова было видно, о чём речь.
import { canComment as underCommentRate, canOpenIssue as underIssueRate } from './limits'

/**
 * ЧТО ЗНАЧИТ «ЗАВЕСТИ ЗАДАЧУ», «ОТВЕТИТЬ» И «ЗАКРЫТЬ» — ОДИН РАЗ НА ВСЕ ПОВЕРХНОСТИ.
 *
 * Здесь ворота (право писать в раздел, запертое обсуждение, частота), сама запись,
 * след в ленте и рассылка уведомлений. Здесь НЕТ ни сессии, ни переходов, ни
 * `revalidatePath`: это разное у формы на сайте и у инструмента MCP, а всё
 * перечисленное выше — одинаковое.
 *
 * Так сделано не из любви к слоям. Задачи получили вторую поверхность (MCP), а второй
 * путь к тому же действию, написанный отдельно, расходится с первым — у нас это уже
 * случилось со слиянием правок: ручное разрешение конфликтов молча забыло версию,
 * проверку исполняемых команд и удаление ветки (#888). Отдельная реализация для агента
 * забыла бы ровно то же: частоту и уведомления.
 *
 * Отказ возвращается ЗНАЧЕНИЕМ. Форме оно нужно, чтобы выбрать адрес перехода,
 * инструменту MCP — чтобы назвать агенту причину словами; переход не годится ни одному
 * из двух как общий язык.
 */
export type IssueRefusal =
  /** Пустой заголовок или пустая реплика — писать нечего. */
  | 'empty'
  /** Списка нет, раздел выключен или задачи с таким номером не существует. */
  | 'not_found'
  /** Прав на запись в этот раздел нет (в т.ч. приватный/черновик для постороннего). */
  | 'forbidden'
  /** Обсуждение заперто: отвечать могут только владелец и коллаборанты. */
  | 'locked'
  /** Слишком часто — сработал счётчик из ./limits. */
  | 'rate'
  /** Закрываем как дубликат, а оригинала с таким номером в этом списке нет. */
  | 'duplicate_not_found'

export type IssueResult<T> = ({ ok: true } & T) | { ok: false; reason: IssueRefusal }

const customIdSet = async (templateId: string) => new Set((await getListLabels(templateId)).map((l) => l.id))

/**
 * Право писать в раздел «Вопросы»: единый предикат, а не своя пара проверок.
 *
 * Копия здесь однажды забыла про ЧЕРНОВИК — посторонний открывал задачу в чужом
 * неопубликованном списке (слаг предсказуем по заголовку), владельцу летело
 * уведомление, notifyMentions рассылал упоминания (линза 02, F4). Коллаборанта
 * досчитываем лениво: за публичный список лишним запросом не платим.
 */
async function canWriteIssues(tpl: ResolvedList, userId: string): Promise<boolean> {
  const isOwner = tpl.ownerId === userId
  return (
    canWriteToFeature(tpl, 'issues', { isOwner }) ||
    canWriteToFeature(tpl, 'issues', { isOwner, isCollaborator: await isCollaborator(tpl.id, userId) })
  )
}

/** Кто узнаёт о событии в задаче: автор, владелец, прежние собеседники, наблюдатели. */
async function issueAudience(issueId: string, templateId: string, authorId: string, ownerId: string) {
  const [commenters, watchers] = await Promise.all([issueCommenterIds(issueId), getWatcherIds(templateId, 'issues')])
  return [authorId, ownerId, ...commenters, ...watchers]
}

/**
 * ЗАВЕСТИ ЗАДАЧУ. Любой залогиненный на видимом списке; приватный/черновик/снятый
 * модерацией — владелец и коллаборанты (те, кто список и так видит).
 */
export async function openIssue(
  userId: string,
  owner: string,
  slug: string,
  input: { title: string; body?: string; labels?: string[] },
): Promise<IssueResult<{ id: string; number: number; templateId: string }>> {
  const title = input.title.trim().slice(0, 200)
  const body = (input.body ?? '').trim().slice(0, 20000)
  if (!title) return { ok: false, reason: 'empty' }

  const tpl = await resolveListBySlug(owner, slug)
  if (!tpl) return { ok: false, reason: 'not_found' }
  // Раздел, выключенный владельцем, проверяется ЗДЕСЬ, а не только на странице:
  // сохранённая форма, прямой вызов action и запрос MCP страницу не проходят.
  if (!(await canWriteIssues(tpl, userId))) return { ok: false, reason: 'forbidden' }

  // ⚠️ ЧАСТОТА — ПОСЛЕ ПРАВ, НО ДО ЗАПИСИ. Каждая задача рассылает уведомления автору,
  // владельцу и наблюдателям, поэтому скрипт в цикле бьёт не только по базе. Ключей
  // два — на человека и на список (см. `limits.ts`, там же выведены числа). Через MCP
  // это тем более не украшение: там пишет как раз программа.
  if (!(await underIssueRate(userId, tpl.id))) return { ok: false, reason: 'rate' }

  const labels = cleanLabels(input.labels ?? [], await customIdSet(tpl.id))
  const ins = await collabStore.openIssue(tpl.id, userId, title, body, labels)

  await subscribeToList(tpl.id, userId) // автор issue следит за списком
  const watchers = await getWatcherIds(tpl.id, 'issues')
  await notifyMany([tpl.ownerId, ...watchers], { actorId: userId, type: 'issue_new', templateId: tpl.id })
  await notifyMentions({ text: `${title}\n${body}`, actorId: userId, templateId: tpl.id, issueId: ins.id })
  return { ok: true, id: ins.id, number: ins.number, templateId: tpl.id }
}

/**
 * ОТВЕТИТЬ В ТРЕДЕ ЗАДАЧИ.
 *
 * Комментарий — запись в тред списка: нельзя к задаче приватного/скрытого/черновика
 * (иначе инъекция в приватную ветку + пинги владельцу + оракул по перебору номеров).
 * Коллаборант проходит так же, как при создании задачи: иначе он открывал бы задачу в
 * приватном списке, видел форму ответа и не мог отправить ни одной реплики — тред,
 * доступный только на запись первой строки (P2 авто-ревью #582).
 */
export async function commentOnIssue(
  userId: string,
  owner: string,
  slug: string,
  number: number,
  rawBody: string,
): Promise<IssueResult<{ id: string; issueId: string; templateId: string }>> {
  const body = rawBody.trim().slice(0, 20000)
  if (!body) return { ok: false, reason: 'empty' }

  const loaded = await loadIssue(owner, slug, number)
  if (!loaded) return { ok: false, reason: 'not_found' }
  const { tpl, iss } = loaded
  if (!(await canWriteIssues(tpl, userId))) return { ok: false, reason: 'forbidden' }

  // ⚠️ ЗАПЕРТОЕ ОБСУЖДЕНИЕ ПРОВЕРЯЕТСЯ ЗДЕСЬ, а не только пряча форму. Форма — это
  // вежливость, а не запрет: адрес действия известен, и отправить в него можно из чего
  // угодно — тем более из программы. Пускаем тех же, кто может запирать: владельца и
  // коллаборантов.
  if (iss.lockedAt) {
    const canManage = userId === tpl.ownerId || (await isCollaborator(tpl.id, userId))
    if (!canManage) return { ok: false, reason: 'locked' }
  }

  if (!(await underCommentRate(userId, tpl.id))) return { ok: false, reason: 'rate' }

  const added = await collabStore.addIssueComment(iss.id, userId, body)
  await subscribeToList(tpl.id, userId) // комментатор начинает следить

  const recipients = await issueAudience(iss.id, tpl.id, iss.authorId, tpl.ownerId)
  await notifyMany(recipients, { actorId: userId, type: 'issue_comment', templateId: tpl.id, issueId: iss.id })
  await notifyMentions({ text: body, actorId: userId, templateId: tpl.id, issueId: iss.id })
  return { ok: true, id: added.id, issueId: iss.id, templateId: tpl.id }
}

/**
 * ЗАКРЫТЬ ИЛИ ПЕРЕОТКРЫТЬ ЗАДАЧУ — автор задачи или владелец списка.
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
export async function changeIssueStatus(
  userId: string,
  owner: string,
  slug: string,
  number: number,
  status: 'open' | 'closed',
  reason?: CloseReason,
  /** Номер задачи-оригинала — только при `duplicate`. */
  duplicateOfNumber?: number,
): Promise<
  IssueResult<{
    issueId: string
    templateId: string
    status: 'open' | 'closed'
    closeReason: CloseReason | null
    duplicateOf: number | null
    /** Была ли запись. `false` — задача уже была в этом состоянии, и её не трогали. */
    changed: boolean
  }>
> {
  const loaded = await loadIssue(owner, slug, number)
  if (!loaded) return { ok: false, reason: 'not_found' }
  const { tpl, iss } = loaded
  if (userId !== iss.authorId && userId !== tpl.ownerId) return { ok: false, reason: 'forbidden' }

  // ⚠️ ПОВТОР ТОГО ЖЕ СОСТОЯНИЯ — НЕ РАБОТА. Закрыть закрытую и открыть открытую можно
  // сколько угодно раз: у статуса счётчика частоты нет, а каждая такая запись шлёт
  // ВСЕМ — автору, владельцу, собеседникам, наблюдателям — новое уведомление и кладёт в
  // ленту ещё одну одинаковую строку. Из браузера это видно как двойное нажатие, через
  // MCP — как цикл. Так же поступает запирание обсуждения (и Gitea), поэтому и здесь
  // тихий «ничего не изменилось», а не отказ: просить закрыть закрытое — не ошибка.
  //
  // Сменить ИСХОД у закрытой задачи этим путём нельзя: для нового исхода её надо сперва
  // открыть заново. Иначе в ленте появилось бы второе «закрыл» без «открыл» между ними.
  if (iss.status === status) {
    return { ok: true, changed: false, issueId: iss.id, templateId: tpl.id, status: iss.status, closeReason: iss.closeReason, duplicateOf: null }
  }

  // Оригинал ищем ПО НОМЕРУ и в ТОМ ЖЕ списке: чужая задача дубликатом не объявляется, и
  // ссылка на неё из другого списка читалась бы как «иди туда, где тебе нечего делать».
  const wantsDuplicate = status === 'closed' && reason === 'duplicate' && !!duplicateOfNumber && duplicateOfNumber !== number
  let duplicateOfId: string | null = null
  if (wantsDuplicate) {
    const [orig] = await db
      .select({ id: issues.id })
      .from(issues)
      .where(and(eq(issues.templateId, tpl.id), eq(issues.number, duplicateOfNumber!)))
      .limit(1)
    // ⚠️ ОТКАЗ, А НЕ ТИХАЯ ПОТЕРЯ ССЫЛКИ. Раньше несуществующий номер просто обнулял
    // связь: задача закрывалась «как дубликат» неизвестно чего — причина обещает
    // оригинал и не говорит где, а спросивший уверен, что ссылку поставил.
    if (!orig) return { ok: false, reason: 'duplicate_not_found' }
    duplicateOfId = orig.id
  }

  await collabStore.setIssueStatus(iss.id, status)
  // Исход живёт, пока задача закрыта. При переоткрытии он снимается — иначе открытая
  // задача носила бы отметку «сделано». В ЛЕНТЕ он при этом остаётся навсегда: «закрыли
  // как не будем делать» — часть разговора, а не текущее состояние (та же развилка, что
  // у причины запирания).
  const closeReason = status === 'closed' ? (reason ?? null) : null
  await db
    .update(issues)
    .set({ closeReason, duplicateOfId: status === 'closed' ? duplicateOfId : null })
    .where(eq(issues.id, iss.id))
  // След в ленте — сразу за статусом (о порядке см. ./events).
  await recordIssueEvent(db, {
    issueId: iss.id,
    actorId: userId,
    kind: status === 'closed' ? 'closed' : 'reopened',
    closeReason,
    duplicateOfId: status === 'closed' ? duplicateOfId : null,
  })

  // ⚠️ Об этом узнают ТЕ ЖЕ, кто узнаёт о новой реплике. Закрытие — не мелочь оформления:
  // для автора это ответ «вопрос снят», для следящих — «тут больше ничего не будет».
  // Раньше молчали вовсе, и человек узнавал о закрытии, случайно вернувшись на страницу.
  // Себе не шлём: `notifyMany` отсекает автора действия.
  const recipients = await issueAudience(iss.id, tpl.id, iss.authorId, tpl.ownerId)
  await notifyMany(recipients, {
    actorId: userId,
    type: status === 'closed' ? 'issue_closed' : 'issue_reopened',
    templateId: tpl.id,
    issueId: iss.id,
  })

  return {
    ok: true,
    changed: true,
    issueId: iss.id,
    templateId: tpl.id,
    status,
    closeReason,
    duplicateOf: duplicateOfId ? duplicateOfNumber! : null,
  }
}
