import Link from 'next/link'
import { Flame, Hash, Sparkles, Users } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { FeedList } from '@/features/library/FeedList'
import { getFeed, getPopularTags } from '@/features/library/queries'
import { searchPeople } from '@/features/profile/search'
import { PeopleResults } from '@/features/profile/PeopleResults'

// Витрина-открытие (не поиск!) в виде вкладок (как в GitHub Explore): каждая
// вкладка грузит только свои данные. Полнотекстовый поиск живёт на /search.
type Tab = 'trending' | 'newest' | 'topics' | 'people'
type TKey = Parameters<typeof t>[0]
const TABS: { id: Tab; icon: typeof Flame; key: TKey }[] = [
  { id: 'trending', icon: Flame, key: 'trending' },
  { id: 'newest', icon: Sparkles, key: 'newest' },
  { id: 'topics', icon: Hash, key: 'popularTags' },
  { id: 'people', icon: Users, key: 'popularPeople' },
]

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ tab }, lang, session] = await Promise.all([searchParams, getLang(), getSession()])
  const active: Tab = TABS.some((x) => x.id === tab) ? (tab as Tab) : 'trending'

  // Грузим только данные активной вкладки.
  const trending = active === 'trending' ? await getFeed({ sort: 'trending' }, session?.userId) : []
  const newest = active === 'newest' ? await getFeed({ sort: 'newest' }, session?.userId) : []
  const tags = active === 'topics' ? await getPopularTags(60) : []
  const people = active === 'people' ? await searchPeople({ sort: 'followers', limit: 24 }) : []

  return (
    <div className="mx-auto w-full max-w-[1080px] px-6 py-8">
      {/* Без заголовка — как в GitHub Explore: сразу вкладки под шапкой. */}
      <nav className="no-scrollbar mb-6 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((tb) => {
          const on = tb.id === active
          const Icon = tb.icon
          return (
            <Link
              key={tb.id}
              href={tb.id === 'trending' ? '/explore' : `/explore?tab=${tb.id}`}
              className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-[13.5px] font-medium transition-colors ${
                on ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink'
              }`}
            >
              <Icon size={15} className={on ? 'text-accent' : 'text-muted'} /> {t(tb.key, lang)}
            </Link>
          )
        })}
      </nav>

      {active === 'trending' && (
        <FeedList items={trending} lang={lang} viewerId={session?.userId} className="space-y-3" />
      )}

      {active === 'newest' && (
        <FeedList items={newest} lang={lang} viewerId={session?.userId} className="space-y-3" />
      )}

      {active === 'topics' && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tg) => (
            <Link
              key={tg.tag}
              href={`/search?q=${encodeURIComponent(`tag:${tg.tag}`)}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[13px] text-ink-2 hover:text-ink hover:border-border-strong"
            >
              {tg.tag}
              <span className="font-mono text-[11px] text-muted">{tg.count}</span>
            </Link>
          ))}
        </div>
      )}

      {active === 'people' && <PeopleResults people={people} lang={lang} />}
    </div>
  )
}
