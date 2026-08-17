import 'server-only'
import { notFound } from 'next/navigation'
import { redirectIfUserMoved } from '@/shared/db/moved-list'
import { getSession } from '@/shared/auth/session'
import { agentProfile } from '@/shared/ai/gnome-account'
import { avatarSrc } from '@/shared/media'
import type { Lang } from '@/shared/i18n'
import { countUnfiledLists, getPinnedTemplates, getProfileListIds, getProfileListPage, type ProfileListFilter } from '@/features/library/queries'
import {
  getActivityTopics,
  getContributions,
  getOwnListsLight,
  getProfileCounts,
  getReceivedStats,
  getUserByHandle,
  getUserCompletions,
} from '@/features/profile/queries'
import { getAchievementDisplay } from '@/features/profile/achievement-config'
import { getFollowers, getFollowing } from '@/features/profile/search'
import { getUserFolders } from '@/features/star-folders/queries'
import { getOwnerCatalogs } from '@/features/catalogs/queries'
import { getFollowCounts, isFollowing } from '@/features/follows/queries'
import { BULK_MAX } from '@/features/library/bulk/limits'
import { dayKey } from '@/features/profile/activity/types'
import { pageCount, pageFromParam, pageHref as buildPageHref, pageWindow } from '@/shared/lib/paging'

export type ProfileTab = 'overview' | 'lists' | 'starred' | 'catalogs' | 'followers' | 'following'

// Размер страницы — общий для всех поверхностей со списками (shared/lib/paging): у них нет
// причин расходиться, а «по 20 тут и по 30 там» это следы разных решений в разное время.

/** Что показываем на вкладке «Списки»: всё или один срез. */
const LIST_TYPES = ['public', 'private', 'forks'] as const
type ListType = (typeof LIST_TYPES)[number] | 'all'

/** Порядок списков; 'recent' — как отдал запрос (по дате звезды/обновления). */
const SORTS = ['recent', 'name', 'stars'] as const
type Sort = (typeof SORTS)[number]

/** Порядок папок звёзд. */
const FOLDER_SORTS = ['name', 'count'] as const
type FolderSort = (typeof FOLDER_SORTS)[number]

/** Значение фильтра «без каталога»: слово вместо пустой строки — иначе `?catalog=` в
 *  адресе неотличимо от «фильтр не задан», и ссылку нельзя ни отправить, ни сохранить. */
export const NO_CATALOG = 'none'

export type ProfileSearchParams = {
  tab?: string
  catalog?: string
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
  // «Сегодня» считаем ЗДЕСЬ и отдаём ключом: год по умолчанию и правый край
  // календаря обязаны идти от одних часов. Иначе в новогоднюю ночь сервер отдаёт
  // уже следующий год, браузер зрителя — ещё прежний, и календарь выходит пустым.
  const today = new Date()
  const nowY = today.getFullYear()
  const regY = new Date(user.createdAt).getFullYear()
  const graphYears = Array.from({ length: nowY - regY + 1 }, (_, i) => nowY - i) // новые сверху
  const rawYear = sp.year ? Number(sp.year) : NaN
  // Без параметра показываем текущий год: пилюли «Последний год» больше нет, и
  // «2026» — это он и есть (решение владельца 12.08).
  const graphYear = graphYears.includes(rawYear) ? rawYear : nowY

  const [counts, followCounts, following, bigAvatar, contributions, received, pinned, catalogs, achDisplay] = await Promise.all([
    getProfileCounts(user.id, viewer?.userId),
    getFollowCounts(user.id),
    viewer && !isOwner ? isFollowing(viewer.userId, user.id) : Promise.resolve(false),
    avatarSrc(user.avatarUrl, 180),
    getContributions(user.id, graphYear, viewer?.userId),
    getReceivedStats(user.id),
    getPinnedTemplates(user.id, viewer?.userId),
    getOwnerCatalogs(user.id, viewer?.userId),
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

  const { monthKey, monthTopics, activityNav } = await loadMonth({
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

  const query = (sp.q ?? '').trim().toLowerCase()
  const sort: Sort = SORTS.find((s) => s === sp.sort) ?? 'recent'
  // Вкладка «Списки»: поиск + фильтр по типу + сортировка (тулбар как у репо GitHub).
  const listType: ListType = LIST_TYPES.find((t) => t === sp.type) ?? 'all'
  // Фильтр по полке: имя каталога или NO_CATALOG. Неизвестное имя фильтром не считаем —
  // иначе опечатка в адресе показывает пустую библиотеку без объяснения.
  const catalogFilter = sp.catalog === NO_CATALOG ? NO_CATALOG : catalogs.find((c) => c.name === sp.catalog)?.name
  const catalogIdByName = new Map(catalogs.map((c) => [c.name, c.id]))

  // ОТБОР, ПОРЯДОК И ОКНО — В ЗАПРОСЕ. Раньше страница поднимала весь подходящий набор
  // и разбиралась с ним в памяти; теперь она спрашивает ровно свою страницу.
  const filter: ProfileListFilter = {
    ownerId: user.id,
    viewerId: viewer?.userId,
    tab: tab === 'starred' ? 'starred' : 'lists',
    query,
    sort,
    listType,
    // undefined = фильтра нет, null = «без полки» (очередь разбора).
    catalogId: catalogFilter === undefined ? undefined : catalogFilter === NO_CATALOG ? null : (catalogIdByName.get(catalogFilter) ?? undefined),
    folder: tab === 'starred' ? sp.folder : undefined,
  }

  // Номер страницы теперь узнаётся ВМЕСТЕ с выдачей, а не до неё: сколько всего строк,
  // знает тот же запрос. Просим запрошенную страницу, а если её не существует —
  // переспрашиваем последнюю. Лишний запрос бывает только на битом номере в адресе,
  // а не на каждом показе, как было бы при отдельном предварительном счёте.
  const asked = Math.max(1, Math.floor(Number(sp.page)) || 1)
  let listPage = isListsTab ? await getProfileListPage(filter, pageWindow(asked)) : { items: [], total: 0 }
  const totalPages = pageCount(listPage.total)
  const page = pageFromParam(sp.page, totalPages)
  if (isListsTab && page !== asked) listPage = await getProfileListPage(filter, pageWindow(page))
  const pageItems = listPage.items
  // Пакетные действия берут ВСЮ текущую выдачу, а не показанную страницу: разбирать
  // полтысячи списков по двадцать штук бессмысленно. Потолок у «всего» всё равно есть.
  const [allIds, unfiledCount] = await Promise.all([
    isOwner && tab === 'lists' ? getProfileListIds({ ...filter, tab: 'lists' }, BULK_MAX) : Promise.resolve([]),
    // Очередь разбора считается ДО фильтров: по ней решается, показывать ли сам фильтр полок.
    isOwner && tab === 'lists' ? countUnfiledLists(user.id, viewer?.userId) : Promise.resolve(0),
  ])
  // Общий построитель: он и переносит остальные параметры сам. Вкладка и фильтр полки
  // названы явно, потому что берутся не из адреса, а из разбора выше (`tab` нормализован,
  // а неизвестное имя полки фильтром не считается) — переносить сырой `sp.catalog` значило
  // бы тащить дальше опечатку, от которой страница только что защитилась.
  // `e` НЕ переносим: это одноразовое уведомление («упёрся в квоту»), а не состояние
  // выдачи. Уехав в ссылку страницы, оно показывало бы баннер снова на второй, третьей
  // и далее — прежний рукописный построитель его не переносил, и это надо сохранить.
  const pageHref = buildPageHref(`/${handle}`, { ...sp, e: undefined, tab, catalog: catalogFilter })

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
    catalogFilter,
    /** Сколько списков ещё не разложено по полкам — очередь разбора одним числом. */
    unfiledCount,
    achDisplay,
    people,
    ownLight,
    completions,
    agent,
    graphYear,
    graphYears,
    todayKey: dayKey(today),
    monthKey,
    monthTopics,
    activityNav,
    starFolders,
    fsort,
    folder: sp.folder,
    query,
    rawQuery: sp.q ?? '',
    sort,
    listType,
    /** Полный видимый набор до поиска и фильтров. Нужен, чтобы на действительно
     *  пустой вкладке не показывать панель, которой нечего фильтровать. Берётся из уже
     *  посчитанных счётчиков профиля — второй раз то же самое не считаем. */
    unfilteredItemsCount: !isListsTab ? 0 : tab === 'starred' ? counts.stars : counts.lists,
    /** Сколько строк в ТЕКУЩЕЙ выдаче (после поиска и фильтров) — по нему и страницы. */
    total: listPage.total,
    /** id всей текущей выдачи для «выбрать все» (только своя вкладка «Списки»). */
    allIds,
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
    // Наружу месяц едет КЛЮЧОМ, а не датой: Date уходит на клиент мгновением времени,
    // и у зрителя западнее UTC 1 августа по серверным часам стало бы июлем в заголовке.
    monthKey: key(monthStart),
    monthTopics: enabled ? await getActivityTopics(userId, monthStart, monthEnd, viewerId) : null,
    activityNav: {
      prev: prev >= firstMonth ? `/${handle}?month=${key(prev)}` : null,
      next: next <= nowMonth ? (key(next) === key(nowMonth) ? `/${handle}` : `/${handle}?month=${key(next)}`) : null,
    },
  }
}
