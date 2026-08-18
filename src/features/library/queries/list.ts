import 'server-only'
import { and, asc, cosineDistance, desc, eq, gte, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm'
import { db, embeddings, issues, listDrafts, milestones, stars, steps, suggestionAssignees, suggestionComments, suggestionReviewRequests, suggestions, suggestionViewed, templates, templateVersions, users, publiclyVisible } from '@/shared/db'
import type { Lang, LocaleText } from '@/shared/i18n'
import { cursorKey, keysetStep } from '@/shared/db/keyset'
import { encodeCursor, probeLimit, takePage, type Cursor, type FeedDirection } from '@/shared/lib/paging'
import { avatarSrc, imageUrl } from '@/shared/media'
import { getSearchSettings } from '@/shared/settings/search'
import { checkRateLimit } from '@/shared/ai/rate-limit'
import { curationStore } from '@/features/curation/store'

/** Резолвит скриншоты шагов: imageKey → подписанный URL. Для префилла редактора и показа. */
export async function getStepPreviews(
  steps: { imageKey: string | null }[],
  options = 'rs:fit:960:960',
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    steps
      .filter((s) => s.imageKey)
      .map(async (s) => [s.imageKey as string, await imageUrl(s.imageKey, options)] as const),
  )
  return Object.fromEntries(entries.filter(([, u]) => u)) as Record<string, string>
}


export type FeedSort = 'trending' | 'newest' | 'mostStarred'

/** Обложка+акцент списка (для настроек и шапки). coverUrl — готовый URL или null. */
export async function getListCover(templateId: string): Promise<{ coverUrl: string | null; accent: string | null }> {
  const [r] = await db.select({ cover: templates.coverImage, accent: templates.accent }).from(templates).where(eq(templates.id, templateId)).limit(1)
  return { coverUrl: r?.cover ? await imageUrl(r.cover, 'rs:fill:1200:400') : null, accent: r?.accent ?? null }
}

export interface FeedItem {
  id: string
  ownerHandle: string
  ownerAvatarUrl: string | null
  slug: string
  title: LocaleText
  desc: LocaleText
  tags: string[]
  version: number
  origin: 'authored' | 'forked' | 'ai_draft'
  status: 'draft' | 'published'
  runsCount: number
  forksCount: number
  starsCount: number
  visibility: 'public' | 'private'
  verified: boolean
  updatedAt: Date
  accent?: string | null
  coverImage?: string | null // после withAvatar — готовый URL обложки (null/undef → авто-баннер)
  repositoryId?: string | null // каталог-«полка»; null = список ещё не разложен
}

export interface TagRow {
  tag: string
  count: number
}








/** Предпочтение языка зрителя в выдаче (ADR-0009: один пул, язык — свойство
 *  списка): списки, у которых есть title на языке зрителя, идут раньше —
 *  внутри групп действует основной order. Ключ jsonb `?` = наличие перевода. */



export type TrendRange = 'day' | 'week' | 'month' | 'all'


/** Счётчик списков под текущий запрос (для бейджа scope-переключателя). По ключевым
    словам, без семантики — этого достаточно для числа рядом с вкладкой. */

export interface ListSuggestion {
  handle: string
  slug: string
  title: LocaleText
}






export interface ActivityItem {
  templateId: string
  ownerHandle: string
  ownerAvatarUrl: string | null
  slug: string
  title: LocaleText
  version: number
  note: string
  origin: 'authored' | 'forked' | 'ai_draft'
  createdAt: Date
}




/** «Открыто» = живые предложения; «закрыто» = принятые и отклонённые (как у GitHub). */






/**
 * АВТОРЫ ВЕРСИИ — их может быть несколько, как у GitHub «mikey-semy and claude».
 *
 * У самой версии автор один (кто записал), но версия часто рождается из ПРИНЯТОЙ правки,
 * а у правки есть автор и соавторы (`suggestions.coauthor_ids` — их дописывает тот, кто
 * дорабатывал чужую правку). Показывать только записавшего значит стирать вклад
 * остальных: в строке последнего коммита это ровно то место, где вклад и виден.
 *
 * Порядок: сначала записавший версию, затем автор правки, затем соавторы; дубли убраны.
 */
export async function getVersionAuthors(templateId: string, version: number) {
  // Два независимых запроса — параллельно: последовательные await здесь удваивали
  // ожидание ни за чем (react-doctor: server-sequential-independent-await).
  const [[ver], [sug]] = await Promise.all([
    db
      .select({ authorId: templateVersions.authorId })
      .from(templateVersions)
      .where(and(eq(templateVersions.templateId, templateId), eq(templateVersions.version, version)))
      .limit(1),
    db
      .select({ authorId: suggestions.authorId, coauthorIds: suggestions.coauthorIds })
      .from(suggestions)
      .where(and(eq(suggestions.templateId, templateId), eq(suggestions.mergedVersion, version)))
      .limit(1),
  ])

  const ids = [ver?.authorId, sug?.authorId, ...((sug?.coauthorIds as string[] | null) ?? [])].filter((v): v is string => !!v)
  const uniq = [...new Set(ids)]
  if (!uniq.length) return []

  const rows = await db
    .select({ id: users.id, handle: users.handle, name: users.name, avatarUrl: users.avatarUrl })
    .from(users)
    .where(inArray(users.id, uniq))
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out = await Promise.all(
    uniq.map(async (id) => {
      const u = byId.get(id)
      return u ? { handle: u.handle, name: u.name, avatarUrl: await avatarSrc(u.avatarUrl, 48) } : null
    }),
  )
  return out.filter((v): v is { handle: string; name: string | null; avatarUrl: string | null } => !!v)
}

/**
 * «КОММИТЫ» СПИСКА — версии с автором для GitHub-подобной страницы истории.
 *
 * Самая длинная выдача на сайте: каждая правка добавляет строку НАВСЕГДА, и история
 * активного списка не сокращается никогда. Отдавалась она целиком, без предела вовсе.
 *
 * Ключ здесь — НОМЕР ВЕРСИИ, а не время. Он уникален в пределах списка и монотонен, то
 * есть является настоящим ключом порядка; время же у пачки версий, созданных одной
 * операцией (импорт, массовая правка садовником), совпадает. Отсюда `keyType: 'int'`:
 * тот же курсор, другое приведение в SQL. Доопределение до `id` избыточно при уникальном
 * номере, но форма шага одна на все поверхности, и заводить ей исключение дороже, чем
 * оставить лишнюю колонку в сравнении.
 *
 * leftJoin — у старых версий и фоновых (gardener/API) автора нет (authorId null).
 */
export async function getCommitsPage(
  templateId: string,
  perPage: number,
  cursor: Cursor | null = null,
  dir: FeedDirection = 'after',
  /** Отбор — В ЗАПРОСЕ, а не после него. Отфильтровать показанную порцию значило бы
   *  отдавать «двадцать штук, из которых подошли три», а следующая страница начиналась бы
   *  не там, где кончилась предыдущая. Ровно тот случай, что записан в грабли трека. */
  filter: { authorHandle?: string; since?: Date } = {},
) {
  // Без курсора шага назад не существует: «перед началом» — не место.
  const back = dir === 'before' && cursor !== null
  const step = keysetStep(templateVersions.version, templateVersions.id, cursor, {
    order: 'desc', // свежая версия сверху, как в истории коммитов
    dir: back ? 'before' : 'after',
    keyType: 'int',
  })
  const rows = await db
    .select({
      id: templateVersions.id,
      version: templateVersions.version,
      note: templateVersions.note,
      createdAt: templateVersions.createdAt,
      cursorKey: cursorKey(templateVersions.version),
      authorId: templateVersions.authorId,
      authorHandle: users.handle,
      authorName: users.name,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(templateVersions)
    .leftJoin(users, eq(templateVersions.authorId, users.id))
    .where(
      and(
        eq(templateVersions.templateId, templateId),
        filter.authorHandle ? eq(users.handle, filter.authorHandle) : undefined,
        filter.since ? gte(templateVersions.createdAt, filter.since) : undefined,
        step.where,
      ),
    )
    .orderBy(...step.order)
    .limit(probeLimit(perPage))

  // Отсекаем лишнюю строку разведчика ДО разворота — иначе отрезался бы не тот конец.
  const { items: taken, hasNext: more } = takePage(rows, perPage)
  const shown = step.reverse ? [...taken].reverse() : taken
  const at = (row: (typeof shown)[number] | undefined): string | null =>
    row ? encodeCursor({ key: row.cursorKey, id: row.id }) : null
  return {
    items: await Promise.all(
      shown.map(async (r) => ({
        id: r.id,
        version: r.version,
        note: r.note,
        createdAt: r.createdAt,
        author:
          r.authorId && r.authorHandle
            ? { handle: r.authorHandle, name: r.authorName, avatarUrl: await avatarSrc(r.authorAvatarUrl, 48) }
            : null,
      })),
    ),
    // Разведчик знает про ту сторону, в которую шагнули; про другую известно из адреса.
    next: back ? at(shown[shown.length - 1]) : more ? at(shown[shown.length - 1]) : null,
    prev: back ? (more ? at(shown[0]) : null) : cursor ? at(shown[0]) : null,
  }
}


/**
 * Сколько всего версий у списка — число в шапке истории.
 *
 * Считается отдельно и БЕЗ фильтров: в шапке стоит «столько-то коммитов у списка», а не
 * «столько-то подошло под отбор». Раньше это была длина полной выдачи — то есть за число
 * в шапке платили подъёмом всей истории.
 */
export async function countCommits(templateId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
  return r?.n ?? 0
}

/**
 * АВТОРЫ ИСТОРИИ — для выпадающего фильтра.
 *
 * Отдельным запросом, а не из показанной порции: список авторов от того, какую страницу
 * истории открыли, зависеть не должен — иначе фильтр по человеку исчезал бы ровно тогда,
 * когда его правок нет на текущей странице, то есть когда он и нужен.
 *
 * Предел — не пагинация, а здравый смысл: выпадающий список не показывает тысячу имён.
 */
export async function getCommitAuthors(templateId: string): Promise<{ handle: string; name: string | null }[]> {
  return db
    .selectDistinct({ handle: users.handle, name: users.name })
    .from(templateVersions)
    .innerJoin(users, eq(templateVersions.authorId, users.id))
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(asc(users.handle))
    .limit(200)
}

export interface Contributor {
  handle: string
  name: string | null
  avatarUrl: string | null
  accepted: number // сколько правок принято (0 = только автор/предлагал)
}

/** Контрибьюторы списка: владелец + авторы предложений (принятые впереди). */
export async function getContributors(templateId: string, ownerId: string): Promise<Contributor[]> {
  const [rows, [owner]] = await Promise.all([
    db
      .select({
        handle: users.handle,
        name: users.name,
        avatarUrl: users.avatarUrl,
        authorId: suggestions.authorId,
        accepted: sql<number>`count(*) filter (where ${suggestions.status} = 'accepted')::int`,
      })
      .from(suggestions)
      .innerJoin(users, eq(suggestions.authorId, users.id))
      .where(eq(suggestions.templateId, templateId))
      .groupBy(users.handle, users.name, users.avatarUrl, suggestions.authorId),
    db
      .select({ handle: users.handle, name: users.name, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, ownerId))
      .limit(1),
  ])
  const list: Contributor[] = []
  if (owner) list.push({ handle: owner.handle, name: owner.name, avatarUrl: owner.avatarUrl, accepted: Infinity })
  for (const r of rows) {
    if (r.authorId === ownerId) continue
    list.push({ handle: r.handle, name: r.name, avatarUrl: r.avatarUrl, accepted: r.accepted })
  }
  list.sort((a, b) => b.accepted - a.accepted)
  return Promise.all(list.map(async (c) => ({ ...c, avatarUrl: await avatarSrc(c.avatarUrl, 48), accepted: Number.isFinite(c.accepted) ? c.accepted : 0 })))
}


/** Отметил ли пользователь список звездой. Через порт CurationStore. */
export const isStarred = (templateId: string, userId: string) => curationStore.isStarred(templateId, userId)


/** Лёгкая мета списка для шапки/сайдбара (без шагов). */
export async function getListMeta(ownerHandle: string, slug: string) {
  const [row] = await db
    .select({
      id: templates.id,
      ownerId: templates.ownerId,
      ownerHandle: users.handle,
      ownerName: users.name,
      ownerAvatarUrl: users.avatarUrl,
      slug: templates.slug,
      title: templates.title,
      desc: templates.desc,
      tags: templates.tags,
      currentVersion: templates.currentVersion,
      mirrorUrl: templates.mirrorUrl,
      mirrorHasToken: templates.mirrorToken,
      mirrorSyncedAt: templates.mirrorSyncedAt,
      mirrorError: templates.mirrorError,
      mirrorAttempts: templates.mirrorAttempts,
      origin: templates.origin,
      status: templates.status,
      ordered: templates.ordered,
      issuesEnabled: templates.issuesEnabled,
      prSettings: templates.prSettings,
      discussionsEnabled: templates.discussionsEnabled,
      pinned: templates.pinned,
      isTemplate: templates.isTemplate,
      living: templates.living, // лента: свежесть вместо полноты, рост вместо полировки
      repositoryId: templates.repositoryId,
      visibility: templates.visibility,
      moderation: templates.moderation,
      moderationReason: templates.moderationReason,
      appealedAt: templates.appealedAt,
      verified: templates.verified,
      archivedAt: templates.archivedAt,
      frozenAt: templates.frozenAt,
      starsCount: templates.starsCount,
      forksCount: templates.forksCount,
      runsCount: templates.runsCount,
      createdAt: templates.createdAt,
      updatedAt: templates.updatedAt,
    })
    .from(templates)
    .innerJoin(users, eq(templates.ownerId, users.id))
    .where(and(eq(users.handle, ownerHandle), eq(templates.slug, slug)))
    .limit(1)
  if (!row) return null
  return { ...row, ownerAvatarUrl: await avatarSrc(row.ownerAvatarUrl, 96) }
}

/** Версии списка (для вкладки «Версии»). */
export async function getVersions(templateId: string) {
  return db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.templateId, templateId))
    .orderBy(desc(templateVersions.version))
}

/** Шаги конкретной версии (по номеру) — для диффа версий. */
export async function getVersionSteps(templateId: string, version: number) {
  const [v] = await db
    .select({ id: templateVersions.id, note: templateVersions.note, createdAt: templateVersions.createdAt })
    .from(templateVersions)
    .where(and(eq(templateVersions.templateId, templateId), eq(templateVersions.version, version)))
    .limit(1)
  if (!v) return null
  const rows = await db
    .select()
    .from(steps)
    .where(eq(steps.versionId, v.id))
    .orderBy(asc(steps.n))
  return { note: v.note, createdAt: v.createdAt, steps: rows }
}

/** Детальный список (owner/slug) + пункты текущей версии. */
export async function getTemplateDetail(ownerHandle: string, slug: string) {
  const owner = await db.select().from(users).where(eq(users.handle, ownerHandle)).limit(1)
  if (!owner[0]) return null

  const tpl = await db.query.templates.findFirst({
    where: (tt, { and, eq: e }) => and(e(tt.ownerId, owner[0].id), e(tt.slug, slug)),
    with: {
      owner: true,
      topic: true,
      versions: { orderBy: (v, { desc: d }) => d(v.version) },
    },
  })
  if (!tpl) return null

  tpl.owner.avatarUrl = await avatarSrc(tpl.owner.avatarUrl, 96)
  const currentVersion = tpl.versions.find((v) => v.version === tpl.currentVersion) ?? tpl.versions[0]
  const stepRows = currentVersion
    ? await db.query.steps.findMany({
        where: (s, { eq: e }) => e(s.versionId, currentVersion.id),
        orderBy: (s, { asc }) => asc(s.n),
      })
    : []

  return { tpl, currentVersion, steps: stepRows }
}







/**
 * Черновик правок автора к этому списку (null — правок нет).
 *
 * ЧИТАЕТСЯ ТОЛЬКО НА СЕРВЕРЕ. В actions.ts ему не место: файл там помечен
 * 'use server', и каждый его экспорт — публичный эндпоинт; функция с authorId в
 * аргументе отдавала бы чужие неопубликованные правки любому желающему.
 */
export async function getDraft(templateId: string, authorId: string) {
  const [row] = await db
    .select()
    .from(listDrafts)
    .where(and(eq(listDrafts.templateId, templateId), eq(listDrafts.authorId, authorId)))
    .limit(1)
  return row ?? null
}
