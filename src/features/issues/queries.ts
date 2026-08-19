import 'server-only'
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { db, issueAssignees, issueComments, issues, listLabels, milestones, users } from '@/shared/db'
import { cursorKey, keysetStep } from '@/shared/db/keyset'
import { feedWindow } from '@/shared/lib/paging'
import { encodeCursor, probeLimit, takePage, type Cursor, type FeedDirection } from '@/shared/lib/paging'
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
export type IssueSort = 'newest' | 'oldest'

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
}

/**
 * Условия отбора задач — ОДИН источник на выдачу и на счёт.
 *
 * Порознь их писать нельзя: счёт даёт число страниц, и разойдись он с выдачей хоть на
 * одно условие — листалка нарисует страницы, которых нет, либо спрячет существующие.
 * Ошибка при этом тихая: обе функции по отдельности выглядят верными.
 */
function issueConds(templateId: string, opts: IssueQuery): SQL[] {
  const conds: SQL[] = [eq(issues.templateId, templateId), eq(issues.status, opts.status)]
  const q = opts.q?.trim()
  if (q) conds.push(sql`${issues.title} ilike ${'%' + q + '%'}`)
  if (opts.label) conds.push(sql`${opts.label} = any(${issues.labels})`)
  if (opts.milestone) conds.push(eq(issues.milestoneId, opts.milestone))
  return conds
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
 * Номера страниц, а не курсор: задачи — КАТАЛОГ, а не лента. Их фильтруют, сортируют и
 * прыгают по ним; порядок задан номером задачи (`issues.number`), который уникален в
 * пределах списка и не меняется, поэтому смещение здесь верно — новые задачи приходят с
 * краю нумерации, а не в середину.
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
  const order = opts.sort === 'oldest' ? asc(issues.number) : desc(issues.number)

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
    .orderBy(order)
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

export async function getIssueCounts(templateId: string): Promise<{ open: number; closed: number }> {
  const rows = await db
    .select({ status: issues.status, c: sql<number>`count(*)::int` })
    .from(issues)
    .where(eq(issues.templateId, templateId))
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
}

export interface IssueComment {
  id: string
  body: string
  createdAt: Date
  authorId: string
  authorHandle: string
  authorAvatarUrl: string | null
}

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
    })
    .from(issues)
    .innerJoin(users, eq(issues.authorId, users.id))
    .leftJoin(milestones, eq(milestones.id, issues.milestoneId))
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

  // Отсекаем лишнюю строку разведчика ДО разворота: развернуть раньше — отрезать не тот
  // конец, то есть потерять ближайшую к читателю реплику.
  const { items: taken, hasNext: more } = takePage(rows, perPage)
  const shown = step.reverse ? [...taken].reverse() : taken
  const at = (row: (typeof shown)[number] | undefined): string | null =>
    row ? encodeCursor({ key: row.cursorKey, id: row.id }) : null
  return {
    items: await Promise.all(
      shown.map(async ({ cursorKey: _k, ...r }) => ({ ...r, authorAvatarUrl: await avatarSrc(r.authorAvatarUrl, 48) })),
    ),
    // Разведчик знает только про ту сторону, в которую шагнули; про другую известно из
    // того, что мы оттуда пришли.
    next: back ? at(shown[shown.length - 1]) : more ? at(shown[shown.length - 1]) : null,
    prev: back ? (more ? at(shown[0]) : null) : cursor ? at(shown[0]) : null,
  }
}
