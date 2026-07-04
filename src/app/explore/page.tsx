import Link from 'next/link'
import { BadgeCheck, Check, Layers, List, ListOrdered, SearchX, Sparkles } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { hasOpenRouterKey } from '@/shared/settings/ai'
import { EmptyState } from '@/shared/ui/EmptyState'
import { FeedList } from '@/features/library/FeedList'
import { QualifierSearch } from '@/features/library/QualifierSearch'
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
  // GitHub-подобный ряд-фасет: иконка + подпись + (счётчик/галочка справа), активный подсвечен.
  const facet = (active: boolean) =>
    `flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${
      active ? 'bg-surface font-semibold text-ink' : 'text-ink-2 hover:bg-surface hover:text-ink'
    }`

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-1 items-stretch">
      <aside className="hidden w-[240px] flex-shrink-0 border-r border-border bg-surface-2 px-3 py-5 md:block">
        <div className="mb-4 text-[13px] font-semibold text-ink">{t('filters', lang)}</div>

        {/* Тип списка — наш аналог фасета «Languages» на GitHub */}
        <div className="mb-4">
          <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('filterType', lang)}</div>
          <div className="flex flex-col gap-0.5">
            <Link href={qs({ type: undefined })} className={facet(!type)}>
              <Layers size={14} className="shrink-0 text-muted" /> {t('filterAllTypes', lang)}
            </Link>
            <Link href={qs({ type: 'ordered' })} className={facet(type === 'ordered')}>
              <ListOrdered size={14} className="shrink-0 text-muted" /> {t('orderedLabel', lang)}
            </Link>
            <Link href={qs({ type: 'unordered' })} className={facet(type === 'unordered')}>
              <List size={14} className="shrink-0 text-muted" /> {t('unorderedLabel', lang)}
            </Link>
          </div>
        </div>

        {/* Проверенные — тумблер-фасет */}
        <div className="mb-4">
          <Link href={qs({ verified: verified ? undefined : '1' })} className={facet(verified)}>
            <BadgeCheck size={14} className={`shrink-0 ${verified ? 'text-ok' : 'text-muted'}`} /> {t('filterVerified', lang)}
            {verified && <Check size={13} className="ml-auto text-accent" />}
          </Link>
        </div>

        {/* Теги — фасет со счётчиками (как «Languages» с числами) */}
        <div>
          <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('tags', lang)}</div>
          <div className="flex flex-col gap-0.5">
            <Link href={qs({ tag: undefined })} className={facet(!sp.tag)}>
              {t('allTags', lang)}
            </Link>
            {tags.map((tg) => (
              <Link key={tg.tag} href={qs({ tag: tg.tag })} className={facet(sp.tag === tg.tag)}>
                <span className="truncate">{tg.tag}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">{tg.count}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Синтаксис поиска: квалификаторы прямо в строке (как на GitHub) */}
        <div className="mt-5 border-t border-border pt-3 text-[11px] leading-relaxed text-muted">
          <div className="mb-1 px-2 font-semibold text-ink-2">{t('searchTips', lang)}</div>
          <div className="px-2 font-mono">
            by:handle · tag:redis · is:verified · type:ordered · stars:&gt;100
          </div>
        </div>
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
