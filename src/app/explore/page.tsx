import Link from 'next/link'
import { SearchX, Sparkles } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { hasOpenRouterKey } from '@/shared/settings/ai'
import { EmptyState } from '@/shared/ui/EmptyState'
import { FeedList } from '@/features/library/FeedList'
import { QualifierSearch } from '@/features/library/QualifierSearch'
import { AdvancedFacets } from '@/features/library/AdvancedFacets'
import { startGeneration } from '@/features/generation/actions'
import { getFeed, getPopularTags, type FeedSort } from '@/features/library/queries'
import { parseSearchQuery } from '@/features/library/search-query'

const SORTS: { key: FeedSort; tkey: 'trending' | 'newest' | 'mostStarred' }[] = [
  { key: 'trending', tkey: 'trending' },
  { key: 'newest', tkey: 'newest' },
  { key: 'mostStarred', tkey: 'mostStarred' },
]

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tag?: string; sort?: string; e?: string; verified?: string; type?: string }>
}) {
  const sp = await searchParams
  const aiOn = hasOpenRouterKey()
  const sort = (SORTS.find((s) => s.key === sp.sort)?.key ?? 'trending') as FeedSort
  const verified = sp.verified === '1'
  const type = sp.type === 'ordered' ? 'ordered' : sp.type === 'unordered' ? 'unordered' : undefined
  // Квалификаторы из строки поиска (by:/tag:/is:/type:/stars:) + свободный текст.
  const parsed = parseSearchQuery(sp.q ?? '')
  const typeQ = parsed.type ?? type
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const [tags, feed] = await Promise.all([
    getPopularTags(),
    getFeed(
      {
        sort,
        tag: sp.tag,
        q: parsed.text || undefined,
        verified: verified || parsed.verified || undefined,
        ordered: typeQ ? typeQ === 'ordered' : undefined,
        by: parsed.by,
        tags: parsed.tags.length ? parsed.tags : undefined,
        minStars: parsed.minStars,
      },
      session?.userId,
    ),
  ])
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    const merged = { q: sp.q, tag: sp.tag, sort: sp.sort, verified: sp.verified, type: sp.type, ...over }
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v)
    const s = p.toString()
    return s ? `/explore?${s}` : '/explore'
  }
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-1 items-stretch">
      <aside className="hidden w-[240px] flex-shrink-0 border-r border-border bg-surface-2 px-3 py-5 md:block">
        <AdvancedFacets initialQ={sp.q ?? ''} tags={tags} lang={lang} />
      </aside>

      <section className="min-w-0 flex-1 px-6 py-4">
        <div className="mb-4">
          <QualifierSearch initial={sp.q ?? ''} tags={tags.map((tg) => tg.tag)} lang={lang} />
        </div>
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
        {sp.e === 'aifail' && (
          <div className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-danger">
            {t('aiFail', lang)}
          </div>
        )}
        {sp.e === 'ratelimited' && (
          <div className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-warn">
            {t('rateLimited', lang)}
          </div>
        )}

        {/* Поиск + нет точного совпадения → предложить сгенерировать (Generate → Verify) */}
        {sp.q && aiOn && (
          <form action={startGeneration} className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-3">
            <Sparkles size={16} className="text-accent" />
            <span className="text-[13px] text-ink">
              {t('cantFind', lang)} <span className="font-semibold">“{sp.q}”</span>
            </span>
            <input type="hidden" name="q" value={sp.q} />
            <button className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[12.5px] font-semibold text-primary-fg">
              <Sparkles size={13} /> {t('generateWithAi', lang)}
            </button>
          </form>
        )}

        {feed.length === 0 ? (
          <div className="py-6">
            <EmptyState
              icon={<SearchX size={36} strokeWidth={1.5} />}
              title={sp.q || sp.tag ? t('nothingFound', lang) : t('emptyExplore', lang)}
              action={!sp.q && session ? { href: '/new', label: t('newList', lang) } : undefined}
            />
          </div>
        ) : (
          <FeedList items={feed} lang={lang} viewerId={session?.userId} className="space-y-3 py-3" />
        )}
      </section>
    </div>
  )
}
