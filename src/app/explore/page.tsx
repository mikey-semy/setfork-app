import Link from 'next/link'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { FeedCard } from '@/features/library/FeedCard'
import { getFeed, getPopularTags, type FeedSort } from '@/features/library/queries'

const SORTS: { key: FeedSort; tkey: 'trending' | 'newest' | 'mostLiked' }[] = [
  { key: 'trending', tkey: 'trending' },
  { key: 'newest', tkey: 'newest' },
  { key: 'mostLiked', tkey: 'mostLiked' },
]

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tag?: string; sort?: string }>
}) {
  const sp = await searchParams
  const sort = (SORTS.find((s) => s.key === sp.sort)?.key ?? 'trending') as FeedSort
  const [lang, tags, feed] = await Promise.all([
    getLang(),
    getPopularTags(),
    getFeed({ sort, tag: sp.tag, q: sp.q }),
  ])
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    const merged = { q: sp.q, tag: sp.tag, sort: sp.sort, ...over }
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v)
    const s = p.toString()
    return s ? `/explore?${s}` : '/explore'
  }

  return (
    <div className="flex flex-1 items-stretch">
      <aside className="hidden w-[260px] flex-shrink-0 border-r border-border bg-surface-2 px-4 py-5 md:block">
        <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">{t('tags', lang)}</div>
        <div className="flex flex-wrap gap-1.5">
          <Link
            href={qs({ tag: undefined })}
            className={`rounded-full px-2.5 py-1 text-[12px] ${
              !sp.tag ? 'bg-primary text-primary-fg' : 'bg-surface text-ink-2 hover:text-ink'
            }`}
          >
            {t('allTags', lang)}
          </Link>
          {tags.map((tg) => (
            <Link
              key={tg.tag}
              href={qs({ tag: tg.tag })}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] ${
                sp.tag === tg.tag ? 'bg-primary text-primary-fg' : 'bg-surface text-ink-2 hover:text-ink'
              }`}
            >
              {tg.tag}
              <span className={`font-mono text-[10.5px] ${sp.tag === tg.tag ? 'text-primary-fg/70' : 'text-muted'}`}>
                {tg.count}
              </span>
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
                className={`pb-2.5 ${sort === s.key ? 'border-b-2 border-ink text-ink' : 'text-ink-2'}`}
              >
                {t(s.tkey, lang)}
              </Link>
            ))}
          </div>
          <span className="text-[12.5px] text-muted">
            {feed.length} {t('ofLists', lang)}
          </span>
        </div>
        {sp.tag && (
          <div className="mt-3 text-[13px] text-ink-2">
            #{sp.tag}{' '}
            <Link href={qs({ tag: undefined })} className="text-accent hover:underline">
              ✕
            </Link>
          </div>
        )}
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
