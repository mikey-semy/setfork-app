import 'server-only'
import { and, asc, desc, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm'
import { db, issues, milestones, suggestionAssignees, suggestionComments, suggestionReviewRequests, suggestions, suggestionViewed, templates, users } from '@/shared/db'
import { cursorKey, keysetPage, keysetStep } from '@/shared/db/keyset'
import { feedWindow, probeLimit, type Cursor, type FeedDirection } from '@/shared/lib/paging'
import { avatarSrc } from '@/shared/media'

export type SuggestionFilter = 'open' | 'closed'
export type SuggestionSort = 'newest' | 'oldest'

/**
 * Чтения вокруг предложений правок: список и одно предложение, комментарии,
 * исполнители, запрошенные рецензенты, метки, веха, отметки «просмотрено» и
 * связанные задачи.
 *
 * Отдельно от чтений самого списка: тут своя причина меняться — что показывает
 * очередь предложений и его карточка.
 */

/**
 * Исполнители СРАЗУ для пачки предложений — по образцу `getIssueAssigneesFor`.
 *
 * Одним запросом, а не по одному на строку: в списке их десятки, и цикл с await
 * превратился бы в столько же походов в БД (та же причина, что у аватаров).
 */
export async function getSuggestionsAssignees(
  ids: string[],
): Promise<Record<string, { handle: string; avatarUrl: string | null }[]>> {
  const out: Record<string, { handle: string; avatarUrl: string | null }[]> = {}
  if (ids.length === 0) return out
  const rows = await db
    .select({ suggestionId: suggestionAssignees.suggestionId, handle: users.handle, avatarUrl: users.avatarUrl })
    .from(suggestionAssignees)
    .innerJoin(users, eq(suggestionAssignees.userId, users.id))
    .where(inArray(suggestionAssignees.suggestionId, ids))
    .orderBy(asc(users.handle))
  const byId: Record<string, typeof rows> = {}
  for (const r of rows) (byId[r.suggestionId] ??= []).push(r)
  for (const [id, list] of Object.entries(byId)) {
    out[id] = await Promise.all(list.map(async (r) => ({ handle: r.handle, avatarUrl: await avatarSrc(r.avatarUrl, 36) })))
  }
  return out
}

/**
 * Личные отметки «просмотрено» зрителя по одному предложению.
 *
 * blockId → отпечаток содержимого на момент отметки. Чужие отметки не выбираем
 * вовсе: это личное состояние ревьюера, и показывать его другим нельзя.
 */
export async function getViewedMarks(
  suggestionId: string,
  userId: string,
): Promise<Map<string, { fp: string; lang: string }>> {
  const rows = await db
    .select({ blockId: suggestionViewed.blockId, fp: suggestionViewed.atFingerprint, lang: suggestionViewed.atLang })
    .from(suggestionViewed)
    .where(and(eq(suggestionViewed.suggestionId, suggestionId), eq(suggestionViewed.userId, userId)))
  return new Map(rows.map((r) => [r.blockId, { fp: r.fp, lang: r.lang }]))
}

/** Сколько открытых и закрытых — для вкладок; считаем одним проходом. */
export async function getSuggestionCounts(templateId: string): Promise<{ open: number; closed: number }> {
  const [row] = await db
    .select({
      open: sql<number>`count(*) filter (where ${suggestions.status} = 'open')::int`,
      closed: sql<number>`count(*) filter (where ${suggestions.status} <> 'open')::int`,
    })
    .from(suggestions)
    .where(eq(suggestions.templateId, templateId))
  return { open: row?.open ?? 0, closed: row?.closed ?? 0 }
}

/** Метки, реально использованные в предложениях списка (для фильтра). */
export async function getSuggestionLabelsInUse(templateId: string): Promise<string[]> {
  const rows = await db.select({ labels: suggestions.labels }).from(suggestions).where(eq(suggestions.templateId, templateId))
  const set = new Set<string>()
  for (const r of rows) for (const l of (r.labels as string[] | null) ?? []) set.add(l)
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** Авторы предложений списка — для фильтра «кто предложил». */
export async function getSuggestionAuthors(templateId: string): Promise<{ handle: string }[]> {
  const rows = await db
    .selectDistinct({ handle: users.handle })
    .from(suggestions)
    .innerJoin(users, eq(suggestions.authorId, users.id))
    .where(eq(suggestions.templateId, templateId))
  return rows.sort((a, b) => a.handle.localeCompare(b.handle))
}

/**
 * Предложения списка с фильтрами — та же форма, что у задач (`getIssues`).
 *
 * `itemCount` считаем В ЗАПРОСЕ и только для предложений с items: у ветковых
 * пункты лежат в git, и `jsonb_array_length(items)` даёт честный ноль, из-за
 * чего список писал «0 пунктов» у явно непустой правки. Для ветки отдаём null —
 * «неизвестно отсюда», и страница показывает ветку вместо вранья.
 */
export interface SuggestionQuery {
  status?: SuggestionFilter
  q?: string
  label?: string
  milestone?: string
  author?: string
  sort?: SuggestionSort
}

/**
 * Условия отбора правок — ОДИН источник на выдачу и на счёт.
 *
 * Порознь их писать нельзя: счёт даёт число страниц, и разойдись он с выдачей хоть на
 * одно условие — листалка нарисует страницы, которых нет, либо спрячет существующие,
 * причём обе функции по отдельности будут выглядеть верными.
 */
function suggestionConds(templateId: string, opts: SuggestionQuery): SQL[] {
  const conds: SQL[] = [eq(suggestions.templateId, templateId)]
  if (opts.status === 'closed') conds.push(sql`${suggestions.status} <> 'open'`)
  else if (opts.status === 'open') conds.push(eq(suggestions.status, 'open'))
  const q = opts.q?.trim()
  if (q) conds.push(sql`${suggestions.note} ilike ${'%' + q + '%'}`)
  if (opts.label) conds.push(sql`${opts.label} = any(${suggestions.labels})`)
  if (opts.milestone) conds.push(eq(suggestions.milestoneId, opts.milestone))
  if (opts.author) conds.push(sql`${users.handle} = ${opts.author}`)
  return conds
}

/** Сколько правок подходит под ТОТ ЖЕ отбор — для числа страниц.
 *  Соединение с `users` обязательно и здесь: по нему идёт фильтр автора. */
export async function countSuggestions(templateId: string, opts: SuggestionQuery = {}): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(suggestions)
    .innerJoin(users, eq(suggestions.authorId, users.id))
    .where(and(...suggestionConds(templateId, opts)))
  return r?.n ?? 0
}

/**
 * Правки списка страницей.
 *
 * Номера страниц, а не курсор: правки — каталог, их фильтруют и сортируют.
 *
 * Раньше выдача шла без предела вовсе — и без доопределения порядка: `createdAt` у пачки
 * правок совпадает (импорт, массовое предложение), а на равных ключах база вправе вернуть
 * строки как угодно. Пока выдача была целиком, это было незаметно; со страницами ровно
 * это и теряет строки.
 */
export async function getSuggestions(
  templateId: string,
  opts: SuggestionQuery = {},
  /** Окно страницы. Проверяется `feedWindow`: битый предел драйвер выбрасывает молча. */
  window?: { limit: number; offset?: number },
) {
  const conds = suggestionConds(templateId, opts)

  const base = db
    .select({
      id: suggestions.id,
      number: suggestions.number,
      status: suggestions.status,
      draft: suggestions.draft,
      note: suggestions.note,
      baseVersion: suggestions.baseVersion,
      branchRef: suggestions.branchRef,
      labels: suggestions.labels,
      createdAt: suggestions.createdAt,
      authorHandle: users.handle,
      authorAvatarUrl: users.avatarUrl,
      milestoneTitle: milestones.title,
      commentCount: sql<number>`(select count(*)::int from ${suggestionComments} sc where sc.suggestion_id = ${suggestions.id})`,
      itemCount: sql<number | null>`case when ${suggestions.branchRef} is null then jsonb_array_length(${suggestions.items}) else null end`,
    })
    .from(suggestions)
    .innerJoin(users, eq(suggestions.authorId, users.id))
    .leftJoin(milestones, eq(milestones.id, suggestions.milestoneId))
    .where(and(...conds))
    .orderBy(
      opts.sort === 'oldest' ? asc(suggestions.createdAt) : desc(suggestions.createdAt),
      asc(suggestions.id),
    )
  const w = window && feedWindow(window)
  const rows = w ? await base.limit(w.limit).offset(w.offset) : await base
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      labels: (r.labels as string[] | null) ?? [],
      author: { handle: r.authorHandle, avatarUrl: await avatarSrc(r.authorAvatarUrl, 64) },
    })),
  )
}

/** Одно предложение с автором (для страницы-обсуждения). */
/**
 * Предложение по НОМЕРУ (#12) или по uuid.
 *
 * Номер — адрес для людей и ссылок; uuid остаётся рабочим, чтобы ранее выданные
 * ссылки не протухли (и чтобы строки без номера, созданные до его введения, всё
 * ещё открывались).
 */
export async function getSuggestion(templateId: string, idOrNumber: string) {
  const asNumber = /^\d+$/.test(idOrNumber) ? Number(idOrNumber) : null
  const row = await db.query.suggestions.findFirst({
    where: (s, { and: a, eq: e }) =>
      asNumber !== null
        ? a(e(s.number, asNumber), e(s.templateId, templateId))
        : a(e(s.id, idOrNumber), e(s.templateId, templateId)),
    with: { author: true },
  })
  if (!row) return null
  return { ...row, author: { ...row.author, avatarUrl: await avatarSrc(row.author.avatarUrl, 64) } }
}

/** Комментарии-обсуждение к предложению. */
/**
 * УЧАСТНИКИ ОБСУЖДЕНИЯ — для подсказки @mention.
 *
 * Отдельным запросом, а не из показанной порции: с тех пор как тред листается, «все
 * комментаторы» и «комментаторы этой порции» — разные множества, и picker на второй
 * порции забыл бы половину людей.
 */
export async function getSuggestionParticipants(
  suggestionId: string,
): Promise<{ handle: string; avatarUrl: string | null }[]> {
  const rows = await db
    .selectDistinct({ handle: users.handle, avatarUrl: users.avatarUrl })
    .from(suggestionComments)
    .innerJoin(users, eq(suggestionComments.authorId, users.id))
    .where(eq(suggestionComments.suggestionId, suggestionId))
    .orderBy(asc(users.handle))
    .limit(100)
  return Promise.all(rows.map(async (r) => ({ ...r, avatarUrl: await avatarSrc(r.avatarUrl, 48) })))
}

/**
 * ПОРЦИЯ ОБСУЖДЕНИЯ ПРЕДЛОЖЕНИЯ — тот же рецепт, что у треда задачи и обсуждения.
 *
 * Порядок показа `asc`: разговор читают с начала. Ключом, а не смещением, — из-за
 * удаления реплики: она сдвигает всё, что ниже, и следующая порция по смещению
 * перепрыгивает ровно одну.
 *
 * Раньше тред отдавался целиком, без предела.
 */
export async function getSuggestionCommentsPage(
  suggestionId: string,
  perPage: number,
  cursor: Cursor | null = null,
  dir: FeedDirection = 'after',
) {
  // Без курсора шага назад не существует: «перед началом» — не место.
  const back = dir === 'before' && cursor !== null
  const step = keysetStep(suggestionComments.createdAt, suggestionComments.id, cursor, {
    order: 'asc',
    dir: back ? 'before' : 'after',
  })
  const rows = await db
    .select({
      id: suggestionComments.id,
      body: suggestionComments.body,
      createdAt: suggestionComments.createdAt,
      // Ключ ТЕКСТОМ: типизированная колонка приезжает без микросекунд (shared/db/keyset).
      cursorKey: cursorKey(suggestionComments.createdAt),
      authorId: suggestionComments.authorId,
      authorHandle: users.handle,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(suggestionComments)
    .innerJoin(users, eq(suggestionComments.authorId, users.id))
    .where(and(eq(suggestionComments.suggestionId, suggestionId), step.where))
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

/** Число открытых предложений. */
export async function getOpenSuggestionCount(templateId: string): Promise<number> {
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(suggestions)
    .where(and(eq(suggestions.templateId, templateId), eq(suggestions.status, 'open')))
  return r?.c ?? 0
}

/** Исполнители правки — форма как у задач (для общего AssigneePicker). */
export async function getSuggestionAssignees(suggestionId: string) {
  const rows = await db
    .select({ handle: users.handle, avatarUrl: users.avatarUrl })
    .from(suggestionAssignees)
    .innerJoin(users, eq(users.id, suggestionAssignees.userId))
    .where(eq(suggestionAssignees.suggestionId, suggestionId))
  return Promise.all(rows.map(async (r) => ({ handle: r.handle, avatarUrl: await avatarSrc(r.avatarUrl, 48) })))
}

/** Задачи по номерам (для связей «closes #N» у предложения). Порядок как в nums. */
export async function getIssuesByNumbers(templateId: string, nums: number[]) {
  if (nums.length === 0) return []
  const rows = await db
    .select({ number: issues.number, title: issues.title, status: issues.status })
    .from(issues)
    .where(and(eq(issues.templateId, templateId), inArray(issues.number, nums)))
  const byNum = new Map(rows.map((r) => [r.number, r]))
  return nums.map((n) => byNum.get(n)).filter((r): r is (typeof rows)[number] => !!r)
}

/** У кого ПОПРОСИЛИ ревью правки (та же форма, что исполнители — один пикер). */
export async function getSuggestionReviewRequests(suggestionId: string) {
  const rows = await db
    .select({ handle: users.handle, avatarUrl: users.avatarUrl })
    .from(suggestionReviewRequests)
    .innerJoin(users, eq(users.id, suggestionReviewRequests.userId))
    .where(eq(suggestionReviewRequests.suggestionId, suggestionId))
  return Promise.all(rows.map(async (r) => ({ handle: r.handle, avatarUrl: await avatarSrc(r.avatarUrl, 48) })))
}

/** Текущий этап правки для пикера ({id,title} или null). */
export async function getSuggestionMilestone(suggestionId: string): Promise<{ id: string; title: string } | null> {
  const [r] = await db
    .select({ id: milestones.id, title: milestones.title })
    .from(suggestions)
    .innerJoin(milestones, eq(milestones.id, suggestions.milestoneId))
    .where(eq(suggestions.id, suggestionId))
    .limit(1)
  return r ?? null
}
