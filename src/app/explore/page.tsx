import Link from 'next/link'
import { Compass, Flame, Hash, Sparkles } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { FeedList } from '@/features/library/FeedList'
import { getFeed, getPopularTags } from '@/features/library/queries'

// Витрина-открытие (не поиск!): трендовые списки, популярные темы, свежее.
// Полнотекстовый/квалификаторный поиск живёт на /search.
export default async function ExplorePage() {
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const [trending, newest, tags] = await Promise.all([
    getFeed({ sort: 'trending' }, session?.userId),
    getFeed({ sort: 'newest' }, session?.userId),
    getPopularTags(24),
  ])

  return (
    <div className="mx-auto w-full max-w-[1080px] px-6 py-8">
      <div className="mb-6 flex items-center gap-2.5">
        <Compass size={22} className="text-accent" />
        <h1 className="text-[22px] font-semibold text-ink">{t('explore', lang)}</h1>
      </div>

      {/* Популярные темы → ведут в поиск по tag: */}
      {tags.length > 0 && (
        <section className="mb-8">
          <div className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-ink-2">
            <Hash size={15} className="text-muted" /> {t('popularTags', lang)}
          </div>
          <div className="flex flex-wrap gap-2">
            {tags.map((tg) => (
              <Link
                key={tg.tag}
                href={`/search?q=${encodeURIComponent(`tag:${tg.tag}`)}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-[12.5px] text-ink-2 hover:text-ink"
              >
                {tg.tag}
                <span className="font-mono text-[10.5px] text-muted">{tg.count}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mb-8">
        <div className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-ink">
          <Flame size={17} className="text-accent" /> {t('trending', lang)}
        </div>
        <FeedList items={trending.slice(0, 9)} lang={lang} viewerId={session?.userId} className="space-y-3" />
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-ink">
          <Sparkles size={17} className="text-accent" /> {t('newest', lang)}
        </div>
        <FeedList items={newest.slice(0, 6)} lang={lang} viewerId={session?.userId} className="space-y-3" />
      </section>
    </div>
  )
}
