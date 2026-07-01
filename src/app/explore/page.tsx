import Link from 'next/link'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { FeedCard } from '@/features/library/FeedCard'
import { getFeed, getTopics, type FeedSort } from '@/features/library/queries'

const SORTS: { key: FeedSort; tkey: 'trending' | 'newest' | 'mostRun' }[] = [
  { key: 'trending', tkey: 'trending' },
  { key: 'newest', tkey: 'newest' },
  { key: 'mostRun', tkey: 'mostRun' },
]

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; topic?: string; sort?: string }>
}) {
  const sp = await searchParams
  const sort = (SORTS.find((s) => s.key === sp.sort)?.key ?? 'trending') as FeedSort
  const [lang, topics, feed] = await Promise.all([
    getLang(),
    getTopics(),
    getFeed({ sort, topicSlug: sp.topic, q: sp.q }),
  ])
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    const merged = { q: sp.q, topic: sp.topic, sort: sp.sort, ...over }
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v)
    const s = p.toString()
    return s ? `/explore?${s}` : '/explore'
  }

  return (
    <div className="flex flex-1 items-stretch">
          <aside className="hidden w-[260px] flex-shrink-0 border-r border-border bg-surface-2 px-4 py-5 md:block">
            <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">
              {t('topics', lang)}
            </div>
            <div className="flex flex-col gap-0.5">
              <Link
                href={qs({ topic: undefined })}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-[13px] ${
                  !sp.topic ? 'bg-[var(--accent-soft)] text-ink' : 'text-ink-2 hover:text-ink'
                }`}
              >
                {t('allTopics', lang)}
              </Link>
              {topics.map((tp) => (
                <Link
                  key={tp.slug}
                  href={qs({ topic: tp.slug })}
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-[7px] ${
                    sp.topic === tp.slug ? 'bg-[var(--accent-soft)]' : 'hover:bg-surface'
                  }`}
                >
                  <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: tp.color }} />
                  <span className={`flex-1 text-[13px] ${sp.topic === tp.slug ? 'text-ink' : 'text-ink-2'}`}>
                    {tr(tp.label, lang)}
                  </span>
                  <span className="font-mono text-[11.5px] text-muted">{tp.count}</span>
                </Link>
              ))}
            </div>
          </aside>

          <section className="min-w-0 flex-1 px-6 py-4">
            <div className="mb-1 flex items-center justify-between border-b border-border pb-1.5">
              <div className="flex gap-4 text-[13.5px] font-semibold">
                {SORTS.map((s) => (
                  <Link
                    key={s.key}
                    href={qs({ sort: s.key })}
                    className={`pb-2.5 ${
                      sort === s.key ? 'border-b-2 border-ink text-ink' : 'text-ink-2'
                    }`}
                  >
                    {t(s.tkey, lang)}
                  </Link>
                ))}
              </div>
              <span className="text-[12.5px] text-muted">
                {feed.length} {t('ofLists', lang)}
              </span>
            </div>
            {feed.length === 0 ? (
              <div className="py-16 text-center text-[13.5px] text-muted">{t('nothingFound', lang)}</div>
            ) : (
              <div className="space-y-3 py-3">
                {feed.map((item) => (
                  <FeedCard key={item.id} item={item} lang={lang} />
                ))}
              </div>
            )}
          </section>
    </div>
  )
}
