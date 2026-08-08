import 'server-only'
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { db, issues, milestones, suggestionAssignees, suggestionComments, suggestionReviewRequests, suggestions, suggestionViewed, templates, users } from '@/shared/db'
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
export async function getSuggestions(
  templateId: string,
  opts: { status?: SuggestionFilter; q?: string; label?: string; milestone?: string; author?: string; sort?: SuggestionSort } = {},
) {
  const conds = [eq(suggestions.templateId, templateId)]
  if (opts.status === 'closed') conds.push(sql`${suggestions.status} <> 'open'`)
  else if (opts.status === 'open') conds.push(eq(suggestions.status, 'open'))
  const q = opts.q?.trim()
  if (q) conds.push(sql`${suggestions.note} ilike ${'%' + q + '%'}`)
  if (opts.label) conds.push(sql`${opts.label} = any(${suggestions.labels})`)
  if (opts.milestone) conds.push(eq(suggestions.milestoneId, opts.milestone))
  if (opts.author) conds.push(sql`${users.handle} = ${opts.author}`)

  const rows = await db
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
    .orderBy(opts.sort === 'oldest' ? asc(suggestions.createdAt) : desc(suggestions.createdAt))
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
export async function getSuggestionComments(suggestionId: string) {
  const rows = await db
    .select({
      id: suggestionComments.id,
      body: suggestionComments.body,
      createdAt: suggestionComments.createdAt,
      authorId: suggestionComments.authorId,
      authorHandle: users.handle,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(suggestionComments)
    .innerJoin(users, eq(suggestionComments.authorId, users.id))
    .where(eq(suggestionComments.suggestionId, suggestionId))
    .orderBy(asc(suggestionComments.createdAt))
  return Promise.all(rows.map(async (r) => ({ ...r, authorAvatarUrl: await avatarSrc(r.authorAvatarUrl, 48) })))
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
