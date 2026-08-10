// БЕЗ loading.tsx намеренно. Скелетон на этом сегменте включает потоковую отдачу:
// шапка ответа уходит клиенту сразу, и notFound() ниже уже не может поставить 404 —
// прод отдавал страницу «не найдено» с кодом 200, а поисковик считал её живой.
// Замер после снятия скелетона: первый байт 0,3 с — ждать нечего.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { redirectIfUserMoved } from '@/shared/db/moved-list'
import { Award, BookOpen, FolderGit2, GraduationCap, Link2, ListChecks, MapPin, Pin, Star, Users } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { agentProfile } from '@/shared/ai/gnome-account'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { EmptyState } from '@/shared/ui/EmptyState'
import { FeedList } from '@/features/library/FeedList'
import { getPinnedTemplates, getUserTemplates } from '@/features/library/queries'
import { getContributions, getMonthActivity, getOwnListsLight, getProfileCounts, getReceivedStats, getStarredTemplates, getUserByHandle, getUserCompletions } from '@/features/profile/queries'
import { ContributionActivity } from '@/features/profile/ContributionActivity'
import { PinsPicker } from '@/features/profile/PinsPicker'
import { getFollowers, getFollowing } from '@/features/profile/search'
import { PeopleResults } from '@/features/profile/PeopleResults'
import { getFolderTemplateIds, getUserFolders } from '@/features/star-folders/queries'
import { TabItem, TabNav } from '@/shared/ui/TabNav'
import { getOwnerCatalogs } from '@/features/catalogs/queries'
import { ActivityGraph } from '@/features/profile/ActivityGraph'
import { AchievementsCard } from '@/features/profile/AchievementsCard'
import { ListsToolbar } from '@/features/profile/ListsToolbar'
import { Pagination } from '@/shared/ui/Pagination'
import { getAchievementDisplay } from '@/features/profile/achievement-config'
import { getFollowCounts, isFollowing } from '@/features/follows/queries'
import { FollowButton } from '@/features/follows/FollowButton'
import { avatarSrc } from '@/shared/media'
import { SocialIcon, socialLabel } from '@/features/settings/socials'
import { displayUrl } from '@/shared/lib/link-label'
import { PAGE } from '@/shared/ui/control'

type Tab = 'overview' | 'lists' | 'starred' | 'catalogs' | 'followers' | 'following'

// Заголовок вкладки: «Имя (handle)» как в GitHub (layout добавит « · SetFork»).
export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const user = await getUserByHandle(handle)
  if (!user) return { title: handle }
  // Приватный профиль не раскрываем в мете (og:title/desc) чужим — только сам ник.
  if (user.profilePrivate) {
    const viewer = await getSession()
    if (viewer?.userId !== user.id) return { title: handle }
  }
  return {
    title: user.name ? `${user.name} (${handle})` : handle,
    description: user.bio ?? undefined,
  }
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>
  searchParams: Promise<{ tab?: string; folder?: string; q?: string; sort?: string; fsort?: string; month?: string; year?: string; e?: string; type?: string; page?: string }>
}) {
  const [{ handle }, sp, lang, viewer] = await Promise.all([params, searchParams, getLang(), getSession()])
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

  const tab: Tab =
    sp.tab === 'lists' ? 'lists'
    : sp.tab === 'starred' ? 'starred'
    : sp.tab === 'catalogs' ? 'catalogs'
    : sp.tab === 'followers' ? 'followers'
    : sp.tab === 'following' ? 'following'
    : 'overview'
  const isPeopleTab = tab === 'followers' || tab === 'following'
  const isListsTab = tab === 'lists' || tab === 'starred'
  const isOwner = viewer?.userId === user.id
  // Год графа активности (?year=YYYY): валиден в диапазоне регистрация…сейчас.
  const nowY = new Date().getFullYear()
  const regY = new Date(user.createdAt).getFullYear()
  const graphYears = Array.from({ length: nowY - regY + 1 }, (_, i) => nowY - i) // новые сверху
  // «Последний год» (скользящее окно) — ВСЕГДА дефолт, как у GitHub: сетка
  // занимает полные 52 недели, даже если аккаунт моложе (прошлое — пустые
  // клетки). Раньше для регистраций текущего года рисовали календарный год
  // «с января по сейчас» — сетка-огрызок росла в течение года (баг-репорт Mike).
  const showRolling = true
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

  // Лента активности (Contribution activity) — на Overview; ?month=YYYY-MM листает историю.
  const nowMonth = new Date()
  nowMonth.setDate(1)
  nowMonth.setHours(0, 0, 0, 0)
  const mMatch = /^(\d{4})-(\d{2})$/.exec(sp.month ?? '')
  let monthStart = nowMonth
  if (mMatch) {
    const cand = new Date(Number(mMatch[1]), Number(mMatch[2]) - 1, 1)
    // не в будущем и не раньше регистрации
    if (cand <= nowMonth && cand >= new Date(user.createdAt.getFullYear(), user.createdAt.getMonth(), 1)) monthStart = cand
  }
  const monthEnd = new Date(monthStart)
  monthEnd.setMonth(monthEnd.getMonth() + 1)
  const monthActivity = tab === 'overview' ? await getMonthActivity(user.id, monthStart, monthEnd, viewer?.userId) : null
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const prevMonth = new Date(monthStart)
  prevMonth.setMonth(prevMonth.getMonth() - 1)
  const nextMonth = new Date(monthEnd)
  const activityNav = {
    prev: prevMonth >= new Date(user.createdAt.getFullYear(), user.createdAt.getMonth(), 1) ? `/${handle}?month=${monthKey(prevMonth)}` : null,
    next: nextMonth <= nowMonth ? (monthKey(nextMonth) === monthKey(nowMonth) ? `/${handle}` : `/${handle}?month=${monthKey(nextMonth)}`) : null,
  }

  // Папки для звёзд (как GitHub Lists): карточки + сорт; звёзды — поиск + сорт.
  const rawFolders = tab === 'starred' ? await getUserFolders(user.id) : []
  const fsort = sp.fsort === 'name' ? 'name' : sp.fsort === 'count' ? 'count' : 'name'
  const starFolders = [...rawFolders].sort((a, b) => (fsort === 'count' ? b.count - a.count : a.name.localeCompare(b.name)))
  const folderIds = tab === 'starred' && sp.folder ? await getFolderTemplateIds(user.id, sp.folder) : null
  const starQ = (sp.q ?? '').trim().toLowerCase()
  const starSort = sp.sort === 'name' ? 'name' : sp.sort === 'stars' ? 'stars' : 'recent'
  let items = folderIds ? rawItems.filter((it) => folderIds.includes(it.id)) : rawItems
  const matchesQ = (it: (typeof items)[number]) =>
    it.slug.toLowerCase().includes(starQ) || Object.values(it.title).some((v) => v?.toLowerCase().includes(starQ))
  if (tab === 'starred') {
    if (starQ) items = items.filter(matchesQ)
    if (starSort === 'name') items = [...items].sort((a, b) => a.slug.localeCompare(b.slug))
    else if (starSort === 'stars') items = [...items].sort((a, b) => b.starsCount - a.starsCount)
    // recent = порядок из запроса (по дате звезды/обновления)
  }
  // Вкладка «Списки»: поиск + фильтр по типу + сортировка (тулбар как у репо GitHub).
  const listType = (['public', 'private', 'forks'] as const).find((tt) => tt === sp.type) ?? 'all'
  const listSort = starSort // тот же ?sort=recent|name|stars
  if (tab === 'lists') {
    if (starQ) items = items.filter(matchesQ)
    if (listType === 'public') items = items.filter((it) => it.visibility === 'public')
    else if (listType === 'private') items = items.filter((it) => it.visibility === 'private')
    else if (listType === 'forks') items = items.filter((it) => it.origin === 'forked')
    if (listSort === 'name') items = [...items].sort((a, b) => a.slug.localeCompare(b.slug))
    else if (listSort === 'stars') items = [...items].sort((a, b) => b.starsCount - a.starsCount)
  }
  // Пагинация вкладок со списками (много репозиториев = боль без страниц).
  const PER_PAGE = 20
  const totalPages = Math.max(1, Math.ceil(items.length / PER_PAGE))
  const curPage = Math.min(Math.max(1, Number(sp.page) || 1), totalPages)
  const pageItems = isListsTab ? items.slice((curPage - 1) * PER_PAGE, curPage * PER_PAGE) : items
  const listPageHref = (p: number) => {
    const qs = new URLSearchParams()
    qs.set('tab', tab)
    if (sp.folder) qs.set('folder', sp.folder)
    if (sp.q) qs.set('q', sp.q)
    if (sp.sort) qs.set('sort', sp.sort)
    if (sp.type) qs.set('type', sp.type)
    if (p > 1) qs.set('page', String(p))
    return `/${handle}?${qs.toString()}`
  }

  return (
    <div className="w-full">
      {/* Табы профиля — full-width под шапкой; единый TabNav из shared/ui. */}
      <TabNav scope="profile" overflow={{ moreLabel: t('moreTabs', lang) }}>
        {isPeopleTab ? (
          <>
            <TabItem href={`/${handle}?tab=followers`} on={tab === 'followers'} icon={<Users size={15} />} label={t('followersLabel', lang)} count={followCounts.followers} />
            <TabItem href={`/${handle}?tab=following`} on={tab === 'following'} icon={<Users size={15} />} label={t('followingLabel', lang)} count={followCounts.following} />
          </>
        ) : (
          <>
            <TabItem href={`/${handle}`} on={tab === 'overview'} icon={<BookOpen size={15} />} label={t('overviewTab', lang)} />
            <TabItem href={`/${handle}?tab=lists`} on={tab === 'lists'} icon={<ListChecks size={15} />} label={t('lists', lang)} count={counts.lists} />
            <TabItem href={`/${handle}?tab=starred`} on={tab === 'starred'} icon={<Star size={15} />} label={t('starredTab', lang)} count={counts.stars} />
            {catalogs.length > 0 && (
              <TabItem href={`/${handle}?tab=catalogs`} on={tab === 'catalogs'} icon={<FolderGit2 size={15} />} label={t('catalogsTab', lang)} count={catalogs.length} />
            )}
          </>
        )}
      </TabNav>

      {sp.e === 'list_quota' && isOwner && (
        <div className={`${PAGE} mt-4`}>
          <div className="rounded-md border border-warn/50 bg-surface px-3 py-2.5 text-[0.8125rem] text-warn">
            {lang === 'ru'
              ? 'Достигнут лимит списков — удали ненужные, чтобы создать/форкнуть новый.'
              : 'List limit reached — delete some to create or fork another.'}
          </div>
        </div>
      )}

      <div className={PAGE}>
      <div className="flex flex-col gap-8 md:flex-row">
        <aside className="shrink-0 md:w-[17.5rem]">
          <Avatar handle={user.handle} avatarUrl={bigAvatar} size={180} rounded={user.avatarShape === 'square' ? 'rounded-2xl' : 'rounded-full'} />
          <div className="mt-4">
            {/* Имя и ник задаёт человек: слово без пробелов иначе вылезает за колонку
                профиля и тянет за собой всю страницу на мобиле. */}
            {user.name && <div className="text-[1.375rem] font-bold leading-tight text-ink [overflow-wrap:anywhere]">{user.name}</div>}
            <div className="text-[1.125rem] text-ink-2 [overflow-wrap:anywhere]">{user.handle}</div>
            {/* Профессия — должность под ником (у служебных участников буквальная). */}
            {user.profession && <div className="mt-0.5 text-[0.875rem] text-ink-2 [overflow-wrap:anywhere]">{user.profession}</div>}
            {/* ADR-0004: нечеловечность обязана быть видна — иначе профиль вводит в
                заблуждение. Пометка ДАННЫЕ (account_type), а не догадка по нику. */}
            {user.accountType === 'agent' && (
              <div className="mt-2 inline-flex items-center rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[0.6875rem] font-semibold text-ink-2">
                {t('list.serviceAccount', lang)}
              </div>
            )}
          </div>
          {/* Био — 280 символов свободного текста, туда часто вставляют ссылку: без
              переноса одна такая строка уносила страницу на 2200px (экран 390). */}
          {user.bio && <p className="mt-3 text-[0.875rem] leading-snug text-ink [overflow-wrap:anywhere]">{user.bio}</p>}

          <div className="mt-4">
            {isOwner ? (
              <Link
                href="/settings"
                className="inline-flex w-full items-center justify-center rounded-md border border-border px-4 py-2 text-[0.8125rem] font-semibold text-ink hover:border-border-strong"
              >
                {t('editProfile', lang)}
              </Link>
            ) : viewer ? (
              <FollowButton targetUserId={user.id} following={following} lang={lang} />
            ) : (
              <Link href="/login" className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-[0.8125rem] font-semibold text-primary-fg">
                {t('follow', lang)}
              </Link>
            )}
          </div>

          <div className="mt-3 flex gap-4 text-[0.8125rem]">
            <Link href={`/${handle}?tab=followers`} className="text-ink-2 hover:text-accent">
              <b className="text-ink">{followCounts.followers}</b> {t('followersLabel', lang)}
            </Link>
            <Link href={`/${handle}?tab=following`} className="text-ink-2 hover:text-accent">
              <b className="text-ink">{followCounts.following}</b> {t('followingLabel', lang)}
            </Link>
          </div>

          <div className="mt-3 font-mono text-[0.78125rem] text-muted">
            {t('joined', lang)}{' '}
            {new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'short' }).format(
              new Date(user.createdAt),
            )}
          </div>
          <div className="mt-4 flex gap-4 text-[0.8125rem]">
            <span className="text-ink-2">
              <b className="text-ink">{counts.lists}</b> {t('lists', lang).toLowerCase()}
            </span>
            <span className="text-ink-2">
              <b className="text-ink">{counts.stars}</b> {t('starredTab', lang).toLowerCase()}
            </span>
          </div>

          {(user.location || user.website || user.socials.length > 0) && (
            <div className="mt-4 flex flex-col gap-2 text-[0.8125rem]">
              {user.location && (
                <div className="flex min-w-0 items-center gap-2 text-ink-2 [overflow-wrap:anywhere]">
                  <MapPin size={15} className="shrink-0 text-muted" /> {user.location}
                </div>
              )}
              {user.website && (
                <a
                  href={user.website}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="flex items-center gap-2 text-accent hover:underline"
                >
                  <Link2 size={15} className="shrink-0 text-muted" /> <span className="truncate">{displayUrl(user.website)}</span>
                </a>
              )}
              {user.socials.map((s) => (
                <a
                  key={`${s.type}:${s.url}`}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="flex items-center gap-2 text-ink-2 hover:text-ink"
                >
                  <SocialIcon type={s.type} className="shrink-0 text-muted" /> <span className="truncate">{socialLabel(s.type)}</span>
                </a>
              ))}
            </div>
          )}

          {/* Достижения — в левом сайдбаре (как у GitHub), отдельно от ленты активности. */}
          <AchievementsCard
            input={{
              listsAuthored: counts.lists,
              starsReceived: received.stars,
              forksReceived: received.forks,
              runsStarted: counts.runs,
              contributions,
            }}
            lang={lang}
            config={achDisplay}
          />
        </aside>

        <section className="min-w-0 flex-1">
          {/* Топ-табы профиля как в GitHub: Overview / Lists / Stars / Catalogs. */}
          {/* Overview: закреплённые (Popular) + граф активности. */}
          {tab === 'overview' && (
            <>
              {/* ЗОНА ОТВЕТСТВЕННОСТИ служебного участника: за какие темы он отвечает.
                  Именно «ведёт», а не владеет — авторство чужих списков не переписываем.
                  Заодно объясняет посетителю, почему правки к этим спискам идут от него. */}
              {agent && agent.tended.length > 0 && (
                <div className="mb-6 min-w-0">
                  <div className="mb-2 text-[0.78125rem] font-semibold text-ink-2">
                    {t('list.tendsTheseLists', lang)}
                  </div>
                  <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
                    {agent.tended.map((it) => (
                      <li key={`${it.handle}/${it.slug}`} className="min-w-0">
                        <Link
                          href={`/${it.handle}/${it.slug}`}
                          className="flex min-w-0 items-center gap-2 px-3 py-3 hover:bg-surface-2"
                        >
                          <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink">
                            {tr(it.title as Parameters<typeof tr>[0], lang) || it.slug}
                          </span>
                          <span className="hidden shrink-0 text-[0.6875rem] text-muted sm:inline">{it.handle}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[0.6875rem] text-muted">
                    {t('list.responsibilityZoneByDomain', lang)}
                  </p>
                </div>
              )}
              {(pinned.length > 0 || (isOwner && ownLight.length > 0)) && (
                <div className="mb-6">
                  <div className="mb-2 flex items-center justify-between gap-2 text-[0.78125rem] font-semibold text-ink-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Pin size={13} className="text-muted" /> {t('pinnedLabel', lang)}
                    </span>
                    {isOwner && <PinsPicker lists={ownLight} lang={lang} />}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {pinned.map((it) => {
                      const desc = tr(it.desc, lang)
                      return (
                        <Link
                          key={it.id}
                          href={`/${it.ownerHandle}/${it.slug}`}
                          className="group rounded-lg border border-border bg-surface px-3.5 py-3 hover:border-border-strong"
                        >
                          <div className="truncate text-[0.875rem] font-semibold text-accent group-hover:underline">{tr(it.title, lang)}</div>
                          {desc && <p className="mt-1 line-clamp-2 text-[0.78125rem] leading-snug text-ink-2">{desc}</p>}
                          <div className="mt-2 flex items-center gap-3 font-mono text-[0.6875rem] text-muted">
                            <span>★ {it.starsCount}</span>
                            <span>⑂ {it.forksCount}</span>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )}
              {completions.length > 0 && (
                <div className="mb-6">
                  <div className="mb-2 flex items-center gap-1.5 text-[0.78125rem] font-semibold text-ink-2">
                    <GraduationCap size={14} className="text-muted" /> {lang === 'ru' ? 'Пройденные курсы' : 'Completed courses'}
                    <span className="font-mono text-[0.6875rem] text-muted">{completions.length}</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {completions.map((c) => (
                      <div key={c.templateId} className="rounded-lg border border-border bg-surface px-3.5 py-3">
                        <Link href={`/${c.ownerHandle}/${c.slug}`} className="block truncate text-[0.875rem] font-semibold text-accent hover:underline">
                          {tr(c.title, lang)}
                        </Link>
                        <div className="mt-1.5 flex items-center justify-between gap-2 font-mono text-[0.6875rem] text-muted">
                          <span className="inline-flex items-center gap-1 text-ok">
                            <GraduationCap size={11} /> {new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(c.completedAt))}
                          </span>
                          {isOwner && (
                            <Link href={`/${c.ownerHandle}/${c.slug}/certificate`} className="inline-flex items-center gap-1 text-accent hover:underline">
                              <Award size={11} /> {lang === 'ru' ? 'сертификат' : 'certificate'}
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <ActivityGraph
                contributions={contributions}
                starsReceived={received.stars}
                forksReceived={received.forks}
                lang={lang}
                year={graphYear}
                years={graphYears}
                showRolling={showRolling}
                base={`/${handle}`}
              />
              {monthActivity && (
                <ContributionActivity activity={monthActivity} monthStart={monthStart} handle={handle} lang={lang} nav={activityNav} />
              )}
            </>
          )}

          {tab === 'overview' ? null : isPeopleTab ? (
            people.length === 0 ? (
              <Empty text={tab === 'followers' ? t('noFollowers', lang) : t('noFollowing', lang)} />
            ) : (
              <PeopleResults people={people} lang={lang} />
            )
          ) : tab === 'catalogs' ? (
            catalogs.length === 0 ? (
              <Empty text={t('noCatalogsYet', lang)} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {catalogs.map((c) => (
                  <Link
                    key={c.id}
                    href={`/${handle}/catalogs/${c.name}`}
                    className="group rounded-lg border border-border bg-surface px-4 py-3 hover:border-border-strong"
                  >
                    <div className="flex items-center gap-2">
                      <FolderGit2 size={15} className="text-muted" />
                      <span className="truncate font-semibold text-accent group-hover:underline">{tr(c.title, lang) || c.name}</span>
                    </div>
                    <div className="mt-1 font-mono text-[0.6875rem] text-muted">
                      {c.listCount} {t('lists', lang).toLowerCase()}
                    </div>
                  </Link>
                ))}
              </div>
            )
          ) : (
            <>
              {/* Stars как у GitHub: секция папок (карточки + сорт), ниже поиск+сорт звёзд. */}
              {tab === 'starred' && starFolders.length > 0 && (
                <div className="mb-6">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[1rem] font-semibold text-ink">
                      {t('foldersLabel', lang)} <span className="font-mono text-[0.78125rem] text-muted">{starFolders.length}</span>
                    </div>
                    <div className="flex gap-1 text-[0.78125rem]">
                      {(['name', 'count'] as const).map((s) => (
                        <Link
                          key={s}
                          href={`/${handle}?tab=starred&fsort=${s}`}
                          className={`rounded px-2 py-0.5 ${fsort === s ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:text-ink'}`}
                        >
                          {s === 'name' ? 'A-Z' : t('byCount', lang)}
                        </Link>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {starFolders.map((f) => {
                      const on = sp.folder === f.name
                      return (
                        <Link
                          key={f.id}
                          href={on ? `/${handle}?tab=starred` : `/${handle}?tab=starred&folder=${encodeURIComponent(f.name)}`}
                          className={`rounded-lg border px-4 py-3 ${on ? 'border-accent bg-accent/10' : 'border-border bg-surface hover:border-border-strong'}`}
                        >
                          <div className="truncate text-[0.875rem] font-semibold text-ink">{f.name}</div>
                          <div className="mt-1 font-mono text-[0.6875rem] text-muted">
                            {f.count} {t('lists', lang).toLowerCase()}
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )}
              {tab === 'starred' && (
                <form action={`/${handle}`} className="mb-4 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="tab" value="starred" />
                  {sp.folder && <input type="hidden" name="folder" value={sp.folder} />}
                  <input
                    name="q"
                    defaultValue={sp.q ?? ''}
                    placeholder={t('searchStarsPh', lang)}
                    className="min-w-[11.25rem] flex-1 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[0.8125rem] text-ink outline-hidden focus:border-border-strong"
                  />
                  <div className="flex gap-1 text-[0.78125rem]">
                    {(['recent', 'name', 'stars'] as const).map((s) => (
                      <Link
                        key={s}
                        href={`/${handle}?tab=starred${sp.folder ? `&folder=${encodeURIComponent(sp.folder)}` : ''}${starQ ? `&q=${encodeURIComponent(sp.q ?? '')}` : ''}&sort=${s}`}
                        className={`rounded px-2 py-0.5 ${starSort === s ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:text-ink'}`}
                      >
                        {s === 'recent' ? t('sortRecent', lang) : s === 'name' ? 'A-Z' : '★'}
                      </Link>
                    ))}
                  </div>
                </form>
              )}
              {tab === 'lists' && (
                <ListsToolbar lang={lang} isOwner={isOwner} q={sp.q ?? ''} type={listType} sort={listSort} />
              )}
              {items.length === 0 ? (
                <Empty text={tab === 'starred' ? t('noStars', lang) : t('noProfileLists', lang)} />
              ) : (
                <>
                  <FeedList items={pageItems} lang={lang} viewerId={viewer?.userId} />
                  <Pagination page={curPage} totalPages={totalPages} makeHref={listPageHref} lang={lang} />
                </>
              )}
            </>
          )}
        </section>
      </div>
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <EmptyState hint={text} />
}
