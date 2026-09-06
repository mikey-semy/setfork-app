import 'server-only'
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db, issueAssignees, issueComments, issues, listLabels, milestones, users } from '@/shared/db'
import { resolveListBySlug } from '@/shared/db/resolve-list'
import { isFeatureEnabled } from '@/core'
import { cursorKey, keysetPage, keysetStep } from '@/shared/db/keyset'
import { issueKeywordCond } from './keyword'
import { feedWindow } from '@/shared/lib/paging'
import { probeLimit, type Cursor, type FeedDirection } from '@/shared/lib/paging'
import { avatarSrc } from '@/shared/media'
import type { CustomLabel } from '@/shared/lib/labels'

/** Кастомные метки списка (для пикеров/чипов/менеджера). */
export async function getListLabels(templateId: string): Promise<CustomLabel[]> {
  return db
    .select({ id: listLabels.id, name: listLabels.name, color: listLabels.color })
    .from(listLabels)
    .where(eq(listLabels.templateId, templateId))
    .orderBy(asc(listLabels.name))
}

export type IssueFilter = 'open' | 'closed'
/**
 * Порядок в списке задач.
 *
 * Набор взят у Gitea (`models/issues/issue_search.go`, `applySorts`): oldest,
 * recentupdate, leastupdate, mostcomment, leastcomment. Имена у нас читаемые, а не её
 * склеенные, — в адресе их видит человек; соответствие такое:
 * `updated` = recentupdate, `least-updated` = leastupdate, `most-commented` = mostcomment,
 * `least-commented` = leastcomment.
 *
 * ⚠️ У КАЖДОГО ПОРЯДКА ЕСТЬ ДОВОДЧИК ДО СТРОГОГО. У Gitea каждая ветка заканчивается
 * `issue.id`, и не для красоты: на равных ключах — а «обновлено» и «ответов» равны
 * сплошь и рядом — соседние страницы вправе показать одну строку дважды, а другую
 * пропустить. У нас доводчик — номер задачи: он уникален в пределах списка.
 */
export type IssueSort = 'newest' | 'oldest' | 'updated' | 'least-updated' | 'most-commented' | 'least-commented'

/** Исходы закрытия — тем же перечнем, что в схеме (см. issueCloseReason). */
export type CloseReason = 'completed' | 'not_planned' | 'duplicate'
export const CLOSE_REASONS: CloseReason[] = ['completed', 'not_planned', 'duplicate']

export const ISSUE_SORTS: IssueSort[] = ['newest', 'oldest', 'updated', 'least-updated', 'most-commented', 'least-commented']

export interface IssueRow {
  id: string
  number: number
  title: string
  status: 'open' | 'closed'
  labels: string[]
  createdAt: Date
  authorHandle: string
  authorAvatarUrl: string | null
  commentCount: number
  milestoneTitle: string | null
}

const commentCountSql = sql<number>`(select count(*)::int from ${issueComments} c where c.issue_id = ${issues.id})`

/** Список issue: статус + опц. поиск, фильтр по label/вехе, сортировка. */
export interface IssueQuery {
  status: IssueFilter
  q?: string
  label?: string
  milestone?: string
  sort?: IssueSort
  /** Автор задачи: id пользователя. «Мои» — это он же, подставленный страницей. */
  authorId?: string
  /** Исполнитель: id пользователя. «Назначено мне» — он же. */
  assigneeId?: string
  /**
   * Чем кончилась задача. Поле есть только у закрытых, поэтому фильтр по нему на вкладке
   * открытых ничего не значит — вызывающий его туда и не передаёт.
   */
  closeReason?: CloseReason
}

/**
 * Условия отбора задач — ОДИН источник на выдачу и на счёт.
 *
 * Порознь их писать нельзя: счёт даёт число страниц, и разойдись он с выдачей хоть на
 * одно условие — листалка нарисует страницы, которых нет, либо спрячет существующие.
 * Ошибка при этом тихая: обе функции по отдельности выглядят верными.
 */
function issueConds(templateId: string, opts: IssueQuery, withStatus = true): SQL[] {
  const conds: SQL[] = [eq(issues.templateId, templateId)]
  if (withStatus) conds.push(eq(issues.status, opts.status))
  const q = opts.q?.trim()
  // Заголовок, тело и реплики — одно правило на все поиски задач (см. ./keyword).
  if (q) conds.push(issueKeywordCond(q))
  if (opts.label) conds.push(sql`${opts.label} = any(${issues.labels})`)
  if (opts.milestone) conds.push(eq(issues.milestoneId, opts.milestone))
  if (opts.authorId) conds.push(eq(issues.authorId, opts.authorId))
  if (opts.closeReason) conds.push(eq(issues.closeReason, opts.closeReason))
  // Исполнителей у задачи несколько, поэтому `exists`, а не соединение: соединение
  // размножило бы строку задачи по числу исполнителей, и счёт стал бы больше выдачи.
  if (opts.assigneeId) {
    conds.push(
      sql`exists (select 1 from ${issueAssignees} where ${issueAssignees.issueId} = ${issues.id} and ${issueAssignees.userId} = ${opts.assigneeId})`,
    )
  }
  return conds
}

/** Порядок выдачи. Доводчик до строгого — номер: он уникален в пределах списка. */
function issueOrder(sort: IssueSort | undefined): SQL[] {
  switch (sort) {
    case 'oldest':
      return [asc(issues.number)]
    case 'updated':
      return [desc(issues.updatedAt), desc(issues.number)]
    case 'least-updated':
      return [asc(issues.updatedAt), asc(issues.number)]
    case 'most-commented':
      return [desc(commentCountSql), desc(issues.number)]
    case 'least-commented':
      return [asc(commentCountSql), desc(issues.number)]
    default:
      return [desc(issues.number)]
  }
}

/** Сколько задач подходит под ТОТ ЖЕ отбор — для числа страниц. */
export async function countListIssues(templateId: string, opts: IssueQuery): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(issues)
    .where(and(...issueConds(templateId, opts)))
  return r?.n ?? 0
}

/**
 * Задачи списка страницей.
 *
 * Задачи — КАТАЛОГ, а не лента: их фильтруют, сортируют и прыгают по ним.
 *
 * СМЕЩЕНИЕ ЗДЕСЬ ДРЕЙФУЕТ — и это принято сознательно, а не упущено. При сортировке
 * «сначала новые» свежая строка встаёт СВЕРХУ, всё едет вниз на одну, и строка с границы
 * приходит на следующую страницу второй раз. Проверено 19.08: страница 1 показывала
 * 6,5,4; после создания одной задачи страница 2 показала 4,3,2. При сортировке «сначала
 * старые» дрейфа нет — там строки приходят в хвост.
 *
 * Почему всё равно номера, а не курсор: по каталогу ПРЫГАЮТ. «Открыть страницу 7»,
 * «уйти на последнюю» — обычные действия для списка задач, и курсор их не умеет вовсе.
 * Цена дрейфа тут другая, чем на ленте: задачи создают редко, читают их с фильтром, а
 * повтор одной строки между страницами не мешает так, как пропавшее уведомление.
 *
 * Раньше выдача шла без предела вовсе: список с тысячей задач поднимал тысячу строк
 * вместе с аватарами авторов и счётчиками комментариев, чтобы показать экран.
 */
export async function getIssues(
  templateId: string,
  opts: IssueQuery,
  /** Окно страницы. Проверяется `feedWindow`: битый предел драйвер выбрасывает молча. */
  window?: { limit: number; offset?: number },
): Promise<IssueRow[]> {
  const conds = issueConds(templateId, opts)
  const order = issueOrder(opts.sort)

  const base = db
    .select({
      id: issues.id,
      number: issues.number,
      title: issues.title,
      status: issues.status,
      labels: issues.labels,
      createdAt: issues.createdAt,
      authorHandle: users.handle,
      authorAvatarUrl: users.avatarUrl,
      commentCount: commentCountSql,
      milestoneTitle: milestones.title,
    })
    .from(issues)
    .innerJoin(users, eq(issues.authorId, users.id))
    .leftJoin(milestones, eq(milestones.id, issues.milestoneId))
    .where(and(...conds))
    .orderBy(...order)
  const w = window && feedWindow(window)
  const rows = w ? await base.limit(w.limit).offset(w.offset) : await base
  return Promise.all(rows.map(async (r) => ({ ...r, authorAvatarUrl: await avatarSrc(r.authorAvatarUrl, 48) })))
}

/**
 * Открытые задачи списка для пикера привязки — только номер и заголовок.
 *
 * Кап в 200: пикер с фильтром, а не бесконечный список; для выбора «какую задачу
 * закроет эта правка» свежих открытых заведомо достаточно.
 */
export async function getOpenIssuesForPicker(templateId: string): Promise<{ number: number; title: string }[]> {
  return db
    .select({ number: issues.number, title: issues.title })
    .from(issues)
    .where(and(eq(issues.templateId, templateId), eq(issues.status, 'open')))
    .orderBy(desc(issues.number))
    .limit(200)
}

/** Уникальные label'ы, использованные в issue списка (для фильтра). */
export async function getIssueLabelsInUse(templateId: string): Promise<string[]> {
  const rows = await db.select({ labels: issues.labels }).from(issues).where(eq(issues.templateId, templateId))
  const set = new Set<string>()
  for (const r of rows) for (const l of r.labels ?? []) set.add(l)
  return [...set].sort((a, b) => a.localeCompare(b))
}

export interface AssigneeRow {
  userId: string
  handle: string
  avatarUrl: string | null
}

/** Исполнители одного issue. */
export async function getIssueAssignees(issueId: string): Promise<AssigneeRow[]> {
  const rows = await db
    .select({ userId: users.id, handle: users.handle, avatarUrl: users.avatarUrl })
    .from(issueAssignees)
    .innerJoin(users, eq(issueAssignees.userId, users.id))
    .where(eq(issueAssignees.issueId, issueId))
    .orderBy(asc(users.handle))
  return Promise.all(rows.map(async (r) => ({ ...r, avatarUrl: await avatarSrc(r.avatarUrl, 48) })))
}

/** Исполнители для набора issue (батч, чтобы не было N+1 на списке). */
export async function getIssueAssigneesFor(issueIds: string[]): Promise<Record<string, AssigneeRow[]>> {
  const out: Record<string, AssigneeRow[]> = {}
  if (issueIds.length === 0) return out
  const rows = await db
    .select({ issueId: issueAssignees.issueId, userId: users.id, handle: users.handle, avatarUrl: users.avatarUrl })
    .from(issueAssignees)
    .innerJoin(users, eq(issueAssignees.userId, users.id))
    .where(inArray(issueAssignees.issueId, issueIds))
    .orderBy(asc(users.handle))
  const byId: Record<string, typeof rows> = {}
  for (const r of rows) (byId[r.issueId] ??= []).push(r)
  for (const [id, list] of Object.entries(byId)) {
    out[id] = await Promise.all(list.map(async (r) => ({ userId: r.userId, handle: r.handle, avatarUrl: await avatarSrc(r.avatarUrl, 36) })))
  }
  return out
}

/**
 * Сколько открытых и закрытых — ПОД ДЕЙСТВУЮЩИМ ОТБОРОМ.
 *
 * ⚠️ Раньше считались все задачи списка, а показывались отобранные: включив «назначено
 * мне», человек видел «12 открытых» и две строки под ними. Та же тихая ложь, что была у
 * бейджа поиска (#874) — и с фильтрами «мои» она становится обычным делом, а не редким.
 * Статус здесь НЕ условие: он и есть то, что считается по обе стороны.
 */
export async function getIssueCounts(templateId: string, opts?: IssueQuery): Promise<{ open: number; closed: number }> {
  const conds = opts ? issueConds(templateId, opts, false) : [eq(issues.templateId, templateId)]
  const rows = await db
    .select({ status: issues.status, c: sql<number>`count(*)::int` })
    .from(issues)
    .where(and(...conds))
    .groupBy(issues.status)
  let open = 0
  let closed = 0
  for (const r of rows) {
    if (r.status === 'open') open = r.c
    else closed = r.c
  }
  return { open, closed }
}

export async function getOpenIssueCount(templateId: string): Promise<number> {
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(issues)
    .where(and(eq(issues.templateId, templateId), eq(issues.status, 'open')))
  return r?.c ?? 0
}

export interface IssueDetail {
  id: string
  number: number
  title: string
  body: string
  status: 'open' | 'closed'
  labels: string[]
  createdAt: Date
  closedAt: Date | null
  authorId: string
  authorHandle: string
  authorAvatarUrl: string | null
  milestoneId: string | null
  milestoneTitle: string | null
  /** Заперто ли обсуждение и за что — страница показывает полосу и убирает форму. */
  lockedAt: Date | null
  lockReason: 'off_topic' | 'too_heated' | 'resolved' | 'spam' | null
  /** Чем кончилась задача. Есть только у закрытых; у закрытых до #892 — null. */
  closeReason: CloseReason | null
  /** Номер задачи-оригинала, если закрыта как дубликат (оригинал мог быть удалён). */
  duplicateNumber: number | null
}

export interface IssueComment {
  id: string
  body: string
  createdAt: Date
  authorId: string
  authorHandle: string
  authorAvatarUrl: string | null
}

/** Задача-оригинал при закрытии дубликатом: та же таблица вторым вхождением. */
const duplicateOf = alias(issues, 'issue_duplicate_of')

export async function getIssue(templateId: string, number: number): Promise<IssueDetail | null> {
  const [row] = await db
    .select({
      id: issues.id,
      number: issues.number,
      title: issues.title,
      body: issues.body,
      status: issues.status,
      labels: issues.labels,
      createdAt: issues.createdAt,
      closedAt: issues.closedAt,
      authorId: issues.authorId,
      authorHandle: users.handle,
      authorAvatarUrl: users.avatarUrl,
      milestoneId: issues.milestoneId,
      milestoneTitle: milestones.title,
      lockedAt: issues.lockedAt,
      lockReason: issues.lockReason,
      // ⚠️ ИСХОД — ПОЛЕ ЗАДАЧИ, А НЕ ТОЛЬКО СТРОКА В ЛЕНТЕ. Пока он жил лишь событием,
      // в длинном треде его не было видно на первой порции: «закрыл» стоит после
      // последней реплики, а до неё листать три страницы. То есть исход завели, чтобы
      // отвечать (#892), а на вопрос «чем кончилось» ни человек, ни агент ответа не
      // получали, хотя в базе он лежал заполненный.
      closeReason: issues.closeReason,
      duplicateNumber: duplicateOf.number,
    })
    .from(issues)
    .innerJoin(users, eq(issues.authorId, users.id))
    .leftJoin(milestones, eq(milestones.id, issues.milestoneId))
    // leftJoin: оригинал могли удалить — тогда исход «дубликат» остаётся, а номера нет.
    .leftJoin(duplicateOf, eq(duplicateOf.id, issues.duplicateOfId))
    .where(and(eq(issues.templateId, templateId), eq(issues.number, number)))
    .limit(1)
  if (!row) return null
  return { ...row, authorAvatarUrl: await avatarSrc(row.authorAvatarUrl, 64) }
}

/**
 * УЧАСТНИКИ ТРЕДА — для подсказки @mention.
 *
 * Отдельным запросом, а не из показанных реплик: с тех пор как тред листается, «все
 * комментаторы» и «комментаторы этой порции» — разные множества, и picker на второй
 * порции забыл бы половину людей. Список участников от порции зависеть не должен.
 *
 * Предел здесь — не пагинация, а здравый смысл: подсказка под курсором не показывает
 * сотни людей, а различных участников у треда столько и не бывает.
 */
export async function getIssueParticipants(issueId: string): Promise<{ handle: string; avatarUrl: string | null }[]> {
  const rows = await db
    .selectDistinct({ handle: users.handle, avatarUrl: users.avatarUrl })
    .from(issueComments)
    .innerJoin(users, eq(issueComments.authorId, users.id))
    .where(eq(issueComments.issueId, issueId))
    .orderBy(asc(users.handle))
    .limit(100)
  return Promise.all(rows.map(async (r) => ({ ...r, avatarUrl: await avatarSrc(r.avatarUrl, 48) })))
}

/**
 * ПОРЦИЯ ТРЕДА — листается ключом, как и лента уведомлений, но порядок ПОКАЗА обратный.
 *
 * Тред читают с начала и дописывают в конец, поэтому `order: 'asc'`, и «дальше» здесь
 * значит «в будущее», а не «в прошлое». Путать это с лентой нельзя: с порядком ленты
 * шаг «дальше» открывал бы тред с конца.
 *
 * Почему вообще ключом, если у треда вставка идёт в ХВОСТ и смещение от неё не едет.
 * Едет от УДАЛЕНИЯ: снятый модерацией или убранный автором комментарий сдвигает всё,
 * что ниже, на одну строку вверх — и следующая порция начинается не с той строки,
 * теряя ровно одну. Вставка сверху для треда редкость, удаление — нет.
 *
 * Раньше тред отдавался ЦЕЛИКОМ, без предела вовсе: у обсуждения на тысячу реплик
 * страница поднимала тысячу строк с аватарами, чтобы показать экран.
 */
export async function getIssueCommentsPage(
  issueId: string,
  perPage: number,
  cursor: Cursor | null = null,
  dir: FeedDirection = 'after',
): Promise<{ items: IssueComment[]; next: string | null; prev: string | null }> {
  // Без курсора шага назад не существует: «перед началом» — не место. Иначе скан против
  // показа без условия открыл бы тред с ПОСЛЕДНЕЙ реплики.
  const back = dir === 'before' && cursor !== null
  const step = keysetStep(issueComments.createdAt, issueComments.id, cursor, {
    order: 'asc',
    dir: back ? 'before' : 'after',
  })
  const rows = await db
    .select({
      id: issueComments.id,
      body: issueComments.body,
      createdAt: issueComments.createdAt,
      // Ключ курсора ТЕКСТОМ: типизированная колонка приезжает без микросекунд, и курсор
      // из неё пропускал бы реплики (см. shared/db/keyset).
      cursorKey: cursorKey(issueComments.createdAt),
      authorId: issueComments.authorId,
      authorHandle: users.handle,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(issueComments)
    .innerJoin(users, eq(issueComments.authorId, users.id))
    .where(and(eq(issueComments.issueId, issueId), step.where))
    .orderBy(...step.order)
    .limit(probeLimit(perPage))

  const { shown, next, prev } = keysetPage(rows, perPage, cursor, { reverse: step.reverse })
  return {
    items: await Promise.all(
      shown.map(async ({ cursorKey: _k, ...r }) => ({ ...r, authorAvatarUrl: await avatarSrc(r.authorAvatarUrl, 48) })),
    ),
    next,
    prev,
  }
}

/**
 * Задача по адресу «владелец/слаг/номер» вместе со списком — общая загрузка для всех
 * действий над задачей. Жила приватно в `actions.ts`, но правка задачи (`edit-actions`)
 * нуждается в том же, а из файла с `'use server'` брать что-либо нельзя: там каждый
 * экспорт становится вызываемым с клиента.
 *
 * Выбираем и текст: он нужен и правке (сравнить, изменилось ли), и истории (сохранить
 * прежнее значение).
 */
export async function loadIssue(owner: string, slug: string, number: number) {
  const tpl = await resolveListBySlug(owner, slug)
  // Выключенный раздел не отдаёт задачу вовсе: всё, что ниже по этому пути, — записи
  // (комментарий, статус, метки, исполнитель) в раздел, которого в списке больше нет.
  if (!tpl || !isFeatureEnabled(tpl, 'issues')) return null
  const [iss] = await db
    .select({
      id: issues.id,
      authorId: issues.authorId,
      status: issues.status,
      // Исход нужен там же, где статус: повторное закрытие УЖЕ закрытой задачи не должно
      // писать событие заново, а сказать в ответе «уже закрыта как…» можно только зная чем.
      closeReason: issues.closeReason,
      title: issues.title,
      body: issues.body,
      // Запертость нужна КАЖДОМУ пишущему действию: форму можно обойти, адрес известен.
      lockedAt: issues.lockedAt,
    })
    .from(issues)
    .where(and(eq(issues.templateId, tpl.id), eq(issues.number, number)))
    .limit(1)
  if (!iss) return null
  return { tpl, iss }
}
