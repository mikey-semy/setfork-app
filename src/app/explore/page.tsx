import Link from 'next/link'
import { Compass, Flame, FolderGit2, Hash, Star, Users } from 'lucide-react'
import { TabItem, TabNav } from '@/shared/ui/TabNav'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { FeedList } from '@/features/library/FeedList'
import { getFeed, getPopularTags, getTrendingFeed, type TrendRange } from '@/features/library/queries'
import { searchPeople } from '@/features/profile/search'
import { PeopleResults } from '@/features/profile/PeopleResults'
import { getPublicCatalogs } from '@/features/catalogs/queries'

// Витрина-открытие (не поиск!) вкладками, как GitHub Explore. Без заголовка под шапкой.
type Tab = 'explore' | 'topics' | 'trending' | 'collections'
type TKey = Parameters<typeof t>[0]
const TABS: { id: Tab; key: TKey }[] = [
  { id: 'explore', key: 'explore' },
  { id: 'topics', key: 'popularTags' },
  { id: 'trending', key: 'trending' },
  { id: 'collections', key: 'catalogsTab' },
]
const RANGES: TrendRange[] = ['day', 'week', 'month', 'all']
const TAB_ICON: Record<Tab, React.ReactNode> = {
  explore: <Compass size={15} />,
  topics: <Hash size={15} />,
  trending: <Flame size={15} />,
  collections: <FolderGit2 size={15} />,
}
const RANGE_LABEL: Record<TrendRange, { en: string; ru: string }> = {
  day: { en: 'Today', ru: 'Сегодня' },
  week: { en: 'This week', ru: 'Неделя' },
  month: { en: 'This month', ru: 'Месяц' },
  all: { en: 'All time', ru: 'Всё время' },
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; view?: string; range?: string }>
}) {
  const [{ tab, view, range }, lang, session] = await Promise.all([searchParams, getLang(), getSession()])
  const active: Tab = TABS.some((x) => x.id === tab) ? (tab as Tab) : 'explore'
  const uid = session?.userId
  const trendView: 'lists' | 'people' = view === 'people' ? 'people' : 'lists'
  const trendRange: TrendRange = RANGES.includes(range as TrendRange) ? (range as TrendRange) : 'week'

  // Данные только активной вкладки.
  const feed = active === 'explore' ? await getFeed({ sort: 'trending' }, uid) : []
  const sidePeople = active === 'explore' ? await searchPeople({ sort: 'followers', limit: 5 }) : []
  const tags = active === 'topics' ? await getPopularTags(60) : []
  const trendLists = active === 'trending' && trendView === 'lists' ? await getTrendingFeed(trendRange, uid) : []
  const trendPeople = active === 'trending' && trendView === 'people' ? await searchPeople({ sort: 'followers', limit: 30 }) : []
  const catalogs = active === 'collections' ? await getPublicCatalogs() : []

  const tabHref = (id: Tab) => (id === 'explore' ? '/explore' : `/explore?tab=${id}`)

  return (
    <div className="w-full">
      {/* Единый TabNav (как профиль/список): переезжающая полоска активной вкладки. */}
      <TabNav maxWidthClass="max-w-[1080px]">
        {TABS.map((tb) => (
          <TabItem key={tb.id} href={tabHref(tb.id)} on={tb.id === active} icon={TAB_ICON[tb.id]} label={t(tb.key, lang)} />
        ))}
      </TabNav>
      <div className="mx-auto w-full max-w-[1080px] px-6 py-6">

      {/* ── Explore: лента + сайдбар виджетов ── */}
      {active === 'explore' && (
        <div className="flex flex-col gap-8 lg:flex-row">
          <div className="min-w-0 flex-1">
            <FeedList items={feed.slice(0, 12)} lang={lang} viewerId={uid} className="space-y-3" />
          </div>
          <aside className="w-full shrink-0 space-y-6 lg:w-[300px]">
            <Widget title={t('trending', lang)} icon={<Star size={14} className="text-accent" />}>
              {feed.slice(0, 5).map((l) => (
                <Link key={l.id} href={`/${l.ownerHandle}/${l.slug}`} className="flex items-center justify-between gap-2 py-1.5 hover:text-accent">
                  <span className="truncate text-[13px] text-ink-2 hover:text-accent">
                    <span className="text-muted">{l.ownerHandle}/</span>
                    {l.slug}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-muted">
                    <Star size={12} /> {l.starsCount}
                  </span>
                </Link>
              ))}
            </Widget>
            <Widget title={t('popularPeople', lang)} icon={<Users size={14} className="text-accent" />}>
              {sidePeople.map((p) => (
                <Link key={p.handle} href={`/${p.handle}`} className="flex items-center gap-2 py-1.5">
                  <Avatar handle={p.handle} avatarUrl={p.avatarUrl} size={26} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-ink">{p.name ?? p.handle}</span>
                    <span className="block truncate text-[12px] text-muted">@{p.handle}</span>
                  </span>
                </Link>
              ))}
            </Widget>
          </aside>
        </div>
      )}

      {/* ── Topics: сетка тегов ── */}
      {active === 'topics' && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tg) => (
            <Link
              key={tg.tag}
              href={`/search?q=${encodeURIComponent(`tag:${tg.tag}`)}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[13px] text-ink-2 hover:border-border-strong hover:text-ink"
            >
              {tg.tag}
              <span className="font-mono text-[11px] text-muted">{tg.count}</span>
            </Link>
          ))}
        </div>
      )}

      {/* ── Trending: переключатель Lists/People + фильтр по дате ── */}
      {active === 'trending' && (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-md border border-border p-0.5 text-[13px]">
              <Link href={`/explore?tab=trending&view=lists&range=${trendRange}`} className={`rounded px-3 py-1 font-medium ${trendView === 'lists' ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'}`}>
                {t('scopeLists', lang)}
              </Link>
              <Link href={`/explore?tab=trending&view=people&range=${trendRange}`} className={`rounded px-3 py-1 font-medium ${trendView === 'people' ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink'}`}>
                {t('scopePeople', lang)}
              </Link>
            </div>
            {trendView === 'lists' && (
              <div className="inline-flex flex-wrap gap-1 text-[12.5px]">
                {RANGES.map((r) => (
                  <Link
                    key={r}
                    href={`/explore?tab=trending&view=lists&range=${r}`}
                    className={`rounded-md px-2.5 py-1 ${r === trendRange ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2 hover:text-ink'}`}
                  >
                    {RANGE_LABEL[r][lang === 'ru' ? 'ru' : 'en']}
                  </Link>
                ))}
              </div>
            )}
          </div>
          {trendView === 'lists' ? (
            trendLists.length === 0 ? (
              <Empty text={t('noProfileLists', lang)} />
            ) : (
              <FeedList items={trendLists.slice(0, 30)} lang={lang} viewerId={uid} className="space-y-3" />
            )
          ) : (
            <PeopleResults people={trendPeople} lang={lang} />
          )}
        </>
      )}

      {/* ── Collections: публичные каталоги ── */}
      {active === 'collections' &&
        (catalogs.length === 0 ? (
          <Empty text={t('noCatalogsYet', lang)} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {catalogs.map((c) => (
              <Link
                key={c.id}
                href={`/${c.ownerHandle}/catalogs/${c.name}`}
                className="group rounded-lg border border-border bg-surface px-4 py-3 hover:border-border-strong"
              >
                <div className="flex items-center gap-2">
                  <FolderGit2 size={15} className="text-muted" />
                  <span className="truncate font-semibold text-accent group-hover:underline">{tr(c.title, lang) || c.name}</span>
                </div>
                {tr(c.desc, lang) && <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-2">{tr(c.desc, lang)}</p>}
                <div className="mt-2 flex items-center gap-2 text-[11.5px] text-muted">
                  <Avatar handle={c.ownerHandle} avatarUrl={c.ownerAvatarUrl} size={16} />
                  <span>{c.ownerHandle}</span>
                  <span className="font-mono">· {c.listCount} {t('lists', lang).toLowerCase()}</span>
                </div>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function Widget({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold text-ink">
        {icon} {title}
      </div>
      {/* Разделители строк — приглушённые, не ярче границ карточки. */}
      <div className="divide-y divide-border/40">{children}</div>
    </section>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-border bg-surface p-8 text-center text-[13px] text-muted">{text}</div>
}
