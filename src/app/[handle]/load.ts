import 'server-only'
import { notFound } from 'next/navigation'
import { redirectIfUserMoved } from '@/shared/db/moved-list'
import { getSession } from '@/shared/auth/session'
import { agentProfile } from '@/shared/ai/gnome-account'
import { avatarSrc } from '@/shared/media'
import type { Lang } from '@/shared/i18n'
import { getPinnedTemplates, getUserTemplates } from '@/features/library/queries'
import {
  getContributions,
  getMonthActivity,
  getOwnListsLight,
  getProfileCounts,
  getReceivedStats,
  getStarredTemplates,
  getUserByHandle,
  getUserCompletions,
} from '@/features/profile/queries'
import { getAchievementDisplay } from '@/features/profile/achievement-config'
import { getFollowers, getFollowing } from '@/features/profile/search'
import { getFolderTemplateIds, getUserFolders } from '@/features/star-folders/queries'
import { getOwnerCatalogs } from '@/features/catalogs/queries'
import { getFollowCounts, isFollowing } from '@/features/follows/queries'

export type ProfileTab = 'overview' | 'lists' | 'starred' | 'catalogs' | 'followers' | 'following'

/** Списков на страницу: без страниц вкладка «Списки» у активного автора не читается. */
const PER_PAGE = 20

/** Что показываем на вкладке «Списки»: всё или один срез. */
const LIST_TYPES = ['public', 'private', 'forks'] as const
type ListType = (typeof LIST_TYPES)[number] | 'all'

/** Порядок списков; 'recent' — как отдал запрос (по дате звезды/обновления). */
const SORTS = ['recent', 'name', 'stars'] as const
type Sort = (typeof SORTS)[number]

/** Порядок папок звёзд. */
const FOLDER_SORTS = ['name', 'count'] as const
type FolderSort = (typeof FOLDER_SORTS)[number]

export type ProfileSearchParams = {
  tab?: string
  folder?: string
  q?: string
  sort?: string
  fsort?: string
  month?: string
  year?: string
  e?: string
  type?: string
  page?: string
}

/** Всё, что странице профиля нужно знать, прежде чем что-то показать. */
export type ProfilePageData = Awaited<ReturnType<typeof loadProfilePage>>

/**
 * Данные и ПРАВИЛА страницы профиля: кто смотрит и можно ли ему сюда, какая вкладка
 * открыта, что попадает в выдачу после поиска/фильтра/сортировки, какая страница
 * пагинации и какой месяц ленты активности.
 *
 * Отдельно от разметки: здесь решается, ЧТО показать, там — как это выглядит.
 */
export async function loadProfilePage({ handle, sp, lang }: { handle: string; sp: ProfileSearchParams; lang: Lang }) {
  const viewer = await getSession()
  const user = await getUserByHandle(handle)
  // Промах может означать «ник сменили»: прежний продолжает вести на человека
  // (перенаправление бросает исключение, как notFound).
  if (!user) {
    await redirectIfUserMoved(handle)
    notFound()
  }
  // Приватный профиль виден только владельцу — для всех прочих 404 (как приватный
  // список). Публичные списки юзера при этом остаются доступны по своим URL.
  if (user.profilePrivate && viewer?.userId !== user.id) notFound()

  const tab = asTab(sp.tab)
  const isPeopleTab = tab === 'followers' || tab === 'following'
  const isListsTab = tab === 'lists' || tab === 'starred'
  const isOwner = viewer?.userId === user.id

  // Год графа активности (?year=YYYY): валиден в диапазоне регистрация…сейчас.
  const nowY = new Date().getFullYear()
  const regY = new Date(user.createdAt).getFullYear()
  const graphYears = Array.from({ length: nowY - regY + 1 }, (_, i) => nowY - i) // новые сверху
  const rawYear = sp.year ? Number(sp.year) : NaN
  const graphYear = graphYears.includes(rawYear) ? rawYear : undefined

  const [counts, followCounts, following, bigAvatar, contributions, received, rawItems, pinned, catalogs, achDisplay] = await Promise.all([
    getProfileCounts(user.id),
    getFollowCounts(user.id),
    viewer && !isOwner ? isFollowing(viewer.userId, user.id) : Promise.resolve(false),
    avatarSrc(user.avatarUrl, 180),
    getContributions(user.id, graphYear, viewer?.userId),
    getReceivedStats(user.id),
    !isListsTab ? Promise.resolve([]) : tab === 'starred' ? getStarredTemplates(user.id, viewer?.userId) : getUserTemplates(user.id, viewer?.userId),
    getPinnedTemplates(user.id, viewer?.userId),
    getOwnerCatalogs(user.id),
    getAchievementDisplay(),
  ])
  const people = tab === 'followers' ? await getFollowers(user.id) : tab === 'following' ? await getFollowing(user.id) : []

  // Пикер пинов («Customize your pins») — только владельцу на Overview.
  const ownLight = tab === 'overview' && isOwner ? await getOwnListsLight(user.id) : []
  // Пройденные курсы (публично видимые) — на Overview.
  const completions = tab === 'overview' ? await getUserCompletions(user.id) : []
  // Служебный участник (ADR-0004): его зона ответственности по доменам. Для людей — null,
  // лишнего запроса не делаем.
  const agent = tab === 'overview' && user.accountType === 'agent' ? await agentProfile(user.id) : null

  const { monthStart, monthActivity, activityNav } = await loadMonth({
    month: sp.month,
    handle,
    userId: user.id,
    createdAt: user.createdAt,
    viewerId: viewer?.userId,
    enabled: tab === 'overview',
  })

  // Папки для звёзд (как GitHub Lists): карточки + сорт; звёзды — поиск + сорт.
  const rawFolders = tab === 'starred' ? await getUserFolders(user.id) : []
  const fsort: FolderSort = FOLDER_SORTS.find((s) => s === sp.fsort) ?? 'name'
  const starFolders = [...rawFolders].sort((a, b) => (fsort === 'count' ? b.count - a.count : a.name.localeCompare(b.name)))
  const folderIds = tab === 'starred' && sp.folder ? await getFolderTemplateIds(user.id, sp.folder) : null

  const query = (sp.q ?? '').trim().toLowerCase()
  const sort: Sort = SORTS.find((s) => s === sp.sort) ?? 'recent'
  // Вкладка «Списки»: поиск + фильтр по типу + сортировка (тулбар как у репо GitHub).
  const listType: ListType = LIST_TYPES.find((t) => t === sp.type) ?? 'all'
  const items = selectItems({ items: folderIds ? rawItems.filter((it) => folderIds.includes(it.id)) : rawItems, tab, query, sort, listType })

  // Пагинация вкладок со списками (много списков = боль без страниц).
  const totalPages = Math.max(1, Math.ceil(items.length / PER_PAGE))
  const page = Math.min(Math.max(1, Number(sp.page) || 1), totalPages)
  const pageItems = isListsTab ? items.slice((page - 1) * PER_PAGE, page * PER_PAGE) : items
  const pageHref = (p: number) => {
    const qs = new URLSearchParams()
    qs.set('tab', tab)
    if (sp.folder) qs.set('folder', sp.folder)
    if (sp.q) qs.set('q', sp.q)
    if (sp.sort) qs.set('sort', sp.sort)
    if (sp.type) qs.set('type', sp.type)
    if (p > 1) qs.set('page', String(p))
    return `/${handle}?${qs.toString()}`
  }

  return {
    handle,
    lang,
    user,
    viewer,
    isOwner,
    tab,
    isPeopleTab,
    isListsTab,
    counts,
    followCounts,
    following,
    bigAvatar,
    contributions,
    received,
    pinned,
    catalogs,
    achDisplay,
    people,
    ownLight,
    completions,
    agent,
    graphYear,
    graphYears,
    monthStart,
    monthActivity,
    activityNav,
    starFolders,
    fsort,
    folder: sp.folder,
    query,
    rawQuery: sp.q ?? '',
    sort,
    listType,
    items,
    pageItems,
    page,
    totalPages,
    pageHref,
    /** ?e=list_quota — вернулись сюда, упершись в потолок списков. */
    quotaHit: sp.e === 'list_quota',
  }
}

function asTab(raw: string | undefined): ProfileTab {
  const tabs: ProfileTab[] = ['lists', 'starred', 'catalogs', 'followers', 'following']
  return tabs.find((t) => t === raw) ?? 'overview'
}

/** Поиск, фильтр по типу и порядок — ровно для той вкладки, где они есть. */
function selectItems<T extends { id: string; slug: string; title: Record<string, string | undefined>; starsCount: number; visibility: string; origin: string | null }>(ctx: {
  items: T[]
  tab: ProfileTab
  query: string
  sort: Sort
  listType: ListType
}): T[] {
  const { tab, query, sort, listType } = ctx
  if (tab !== 'lists' && tab !== 'starred') return ctx.items

  let items = ctx.items
  if (query) items = items.filter((it) => it.slug.toLowerCase().includes(query) || Object.values(it.title).some((v) => v?.toLowerCase().includes(query)))
  if (tab === 'lists' && listType !== 'all') {
    items = items.filter((it) => (listType === 'forks' ? it.origin === 'forked' : it.visibility === listType))
  }
  if (sort === 'name') items = [...items].sort((a, b) => a.slug.localeCompare(b.slug))
  else if (sort === 'stars') items = [...items].sort((a, b) => b.starsCount - a.starsCount)
  return items
}

/**
 * Лента активности за месяц (?month=YYYY-MM) и стрелки листания: назад — не раньше
 * месяца регистрации, вперёд — не в будущее. Текущий месяц адресуется без параметра,
 * чтобы «сейчас» имело один канонический адрес.
 */
async function loadMonth(ctx: {
  month: string | undefined
  handle: string
  userId: string
  createdAt: Date
  viewerId: string | undefined
  enabled: boolean
}) {
  const { month, handle, userId, createdAt, viewerId, enabled } = ctx
  const nowMonth = new Date()
  nowMonth.setDate(1)
  nowMonth.setHours(0, 0, 0, 0)
  const firstMonth = new Date(createdAt.getFullYear(), createdAt.getMonth(), 1)

  const asked = /^(\d{4})-(\d{2})$/.exec(month ?? '')
  let monthStart = nowMonth
  if (asked) {
    const cand = new Date(Number(asked[1]), Number(asked[2]) - 1, 1)
    if (cand <= nowMonth && cand >= firstMonth) monthStart = cand
  }
  const monthEnd = new Date(monthStart)
  monthEnd.setMonth(monthEnd.getMonth() + 1)

  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const prev = new Date(monthStart)
  prev.setMonth(prev.getMonth() - 1)
  const next = new Date(monthEnd)

  return {
    monthStart,
    monthActivity: enabled ? await getMonthActivity(userId, monthStart, monthEnd, viewerId) : null,
    activityNav: {
      prev: prev >= firstMonth ? `/${handle}?month=${key(prev)}` : null,
      next: next <= nowMonth ? (key(next) === key(nowMonth) ? `/${handle}` : `/${handle}?month=${key(next)}`) : null,
    },
  }
}
