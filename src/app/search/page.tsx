import Link from 'next/link'
import { ChevronDown, SearchX, Sparkles, Users } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { hasOpenRouterKey } from '@/shared/settings/ai'
import { EmptyState } from '@/shared/ui/EmptyState'
import { FeedList } from '@/features/library/FeedList'
import { AdvancedFacets } from '@/features/library/AdvancedFacets'
import { ScopeSwitcher, type Scope } from '@/features/library/ScopeSwitcher'
import { startGeneration } from '@/features/generation/actions'
import { countLists, getFeed, getPopularTags, type FeedSort } from '@/features/library/queries'
import { countPeople, searchPeople, type PeopleSort } from '@/features/profile/search'
import { PeopleResults } from '@/features/profile/PeopleResults'
import { countIssues, searchIssues, type IssueStateFilter } from '@/features/issues/search'
import { IssueResults } from '@/features/issues/IssueResults'
import { parseSearchQuery } from '@/features/library/search-query'

const BASE = '/search'
const SORTS: { key: FeedSort; tkey: 'trending' | 'newest' | 'mostStarred' }[] = [
  { key: 'trending', tkey: 'trending' },
  { key: 'newest', tkey: 'newest' },
  { key: 'mostStarred', tkey: 'mostStarred' },
]
const PEOPLE_SORTS: { key: PeopleSort; tkey: 'sortFollowers' | 'sortLists' | 'sortNewest' }[] = [
  { key: 'followers', tkey: 'sortFollowers' },
  { key: 'lists', tkey: 'sortLists' },
  { key: 'newest', tkey: 'sortNewest' },
]
const ISSUE_STATES: { key: IssueStateFilter; tkey: 'stateOpen' | 'stateClosed' }[] = [
  { key: 'open', tkey: 'stateOpen' },
  { key: 'closed', tkey: 'stateClosed' },
]

export const metadata = { title: 'Search' }

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    tag?: string
    sort?: string
    e?: string
    verified?: string
    type?: string
    scope?: string
    psort?: string
    state?: string
  }>
}) {
  const sp = await searchParams
  const aiOn = hasOpenRouterKey()
  const scope: Scope = sp.scope === 'people' ? 'people' : sp.scope === 'issues' ? 'issues' : 'lists'
  const sort = (SORTS.find((s) => s.key === sp.sort)?.key ?? 'trending') as FeedSort
  const peopleSort = (PEOPLE_SORTS.find((s) => s.key === sp.psort)?.key ?? 'followers') as PeopleSort
  const issueState = (ISSUE_STATES.find((s) => s.key === sp.state)?.key ?? 'open') as IssueStateFilter
  const verified = sp.verified === '1'
  const type = sp.type === 'ordered' ? 'ordered' : sp.type === 'unordered' ? 'unordered' : undefined
  // Квалификаторы из строки поиска (by:/tag:/is:/type:/stars:) + свободный текст.
  const parsed = parseSearchQuery(sp.q ?? '')
  const typeQ = parsed.type ?? type
  const text = parsed.text.trim() || undefined
  // Генерируем СПИСОК только по свободному тексту-теме; чистые фильтры (by:/tag:) — нет.
  const canGenerate = aiOn && Boolean(text)

  const listOpts = {
    tag: sp.tag,
    q: text,
    verified: verified || parsed.verified || undefined,
    ordered: typeQ ? typeQ === 'ordered' : undefined,
    by: parsed.by,
    tags: parsed.tags.length ? parsed.tags : undefined,
    minStars: parsed.minStars,
  }

  const [lang, session] = await Promise.all([getLang(), getSession()])
  // Бейджи scope-переключателя считаем всегда; полную выдачу — только активного scope.
  const [tags, counts, feed, people, issueRows] = await Promise.all([
    getPopularTags(),
    Promise.all([countLists(listOpts, session?.userId), countPeople(text), countIssues(text, 'all')]).then(
      ([lists, ppl, iss]) => ({ lists, people: ppl, issues: iss }),
    ),
    scope === 'lists' ? getFeed({ ...listOpts, sort }, session?.userId, lang) : Promise.resolve([]),
    scope === 'people' ? searchPeople({ q: text, sort: peopleSort }) : Promise.resolve([]),
    scope === 'issues' ? searchIssues({ q: text, state: issueState }) : Promise.resolve([]),
  ])

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    const merged = { q: sp.q, tag: sp.tag, sort: sp.sort, verified: sp.verified, type: sp.type, ...over }
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v)
    const s = p.toString()
    return s ? `${BASE}?${s}` : BASE
  }
  // Ссылки табов внутри scope people/issues (сохраняем свободный текст).
  const scopeTab = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    if (sp.q) p.set('q', sp.q)
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v)
    return `${BASE}?${p.toString()}`
  }
  const tabCls = (on: boolean) => `pb-2.5 ${on ? 'border-b-2 border-ink text-ink' : 'text-ink-2'}`

  return (
    <div className="flex w-full flex-1 items-stretch">
      <aside className="hidden w-[260px] shrink-0 border-r border-border bg-surface-2 px-3 py-5 lg:block">
        <ScopeSwitcher active={scope} counts={counts} q={sp.q} sort={sp.sort} lang={lang} basePath={BASE} />
        {/* List-специфичные фасеты — только для scope=lists */}
        {scope === 'lists' && <AdvancedFacets initialQ={sp.q ?? ''} tags={tags} lang={lang} basePath={BASE} />}
      </aside>

      <section className="min-w-0 flex-1 px-4 py-4 md:px-6">
       <div className="mx-auto flex w-full max-w-[1120px] gap-6">
        <div className="min-w-0 flex-1">
        {/* Мобильный доступ к scope и фильтрам (сайдбар скрыт < lg) */}
        <div className="mb-3 lg:hidden">
          <ScopeSwitcher active={scope} counts={counts} q={sp.q} sort={sp.sort} lang={lang} basePath={BASE} orientation="horizontal" />
          {scope === 'lists' && (
            <details className="group mt-2 rounded-md border border-border bg-surface-2 px-3 py-2">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-semibold text-ink-2">
                <ChevronDown size={14} className="text-muted transition-transform group-open:rotate-180" />
                {t('filters', lang)}
              </summary>
              <div className="mt-3">
                <AdvancedFacets initialQ={sp.q ?? ''} tags={tags} lang={lang} basePath={BASE} showHeader={false} />
              </div>
            </details>
          )}
        </div>

        <div className="mb-1 flex items-center justify-between border-b border-border pb-1.5">
          <div className="flex gap-4 text-[13.5px] font-semibold">
            {scope === 'lists' &&
              SORTS.map((s) => (
                <Link key={s.key} href={qs({ sort: s.key })} className={tabCls(sort === s.key)}>
                  {t(s.tkey, lang)}
                </Link>
              ))}
            {scope === 'people' &&
              PEOPLE_SORTS.map((s) => (
                <Link key={s.key} href={scopeTab({ scope: 'people', psort: s.key })} className={tabCls(peopleSort === s.key)}>
                  {t(s.tkey, lang)}
                </Link>
              ))}
            {scope === 'issues' &&
              ISSUE_STATES.map((s) => (
                <Link key={s.key} href={scopeTab({ scope: 'issues', state: s.key })} className={tabCls(issueState === s.key)}>
                  {t(s.tkey, lang)}
                </Link>
              ))}
          </div>
          <span className="text-[12.5px] text-muted">
            {scope === 'lists' && `${counts.lists} ${t('ofLists', lang)}`}
            {scope === 'people' && `${counts.people} ${t('ofPeople', lang)}`}
            {scope === 'issues' && `${counts.issues} ${t('ofIssues', lang)}`}
          </span>
        </div>

        {sp.tag && scope === 'lists' && (
          <div className="mt-3 text-[13px] text-ink-2">
            #{sp.tag}{' '}
            <Link href={qs({ tag: undefined })} className="text-accent hover:underline">
              ✕
            </Link>
          </div>
        )}
        {sp.e === 'aifail' && (
          <div className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-danger">{t('aiFail', lang)}</div>
        )}
        {sp.e === 'ratelimited' && (
          <div className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-warn">{t('rateLimited', lang)}</div>
        )}

        {/* ── Lists ── */}
        {scope === 'lists' && (
          <>
            {canGenerate && feed.length === 0 && (
              <form action={startGeneration} className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-(--accent) bg-(--accent-soft) px-4 py-3">
                <Sparkles size={16} className="text-accent" />
                <span className="text-[13px] text-ink">
                  {t('cantFind', lang)} <span className="font-semibold">“{parsed.text}”</span>
                </span>
                <input type="hidden" name="q" value={parsed.text} />
                <button className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[12.5px] font-semibold text-primary-fg">
                  <Sparkles size={13} /> {t('generateWithAi', lang)}
                </button>
              </form>
            )}
            {feed.length === 0 ? (
              canGenerate ? null : (
                <div className="py-6">
                  <EmptyState
                    icon={<SearchX size={36} strokeWidth={1.5} />}
                    title={sp.q || sp.tag ? t('nothingFound', lang) : t('searchPrompt', lang)}
                    action={!sp.q && session ? { href: '/new', label: t('newList', lang) } : undefined}
                  />
                </div>
              )
            ) : (
              <FeedList items={feed} lang={lang} viewerId={session?.userId} className="space-y-3 py-3" />
            )}
          </>
        )}

        {/* ── People ── */}
        {scope === 'people' &&
          (people.length === 0 ? (
            <div className="py-6">
              <EmptyState icon={<Users size={36} strokeWidth={1.5} />} title={t('noPeopleFound', lang)} />
            </div>
          ) : (
            <PeopleResults people={people} lang={lang} />
          ))}

        {/* ── Issues ── */}
        {scope === 'issues' &&
          (issueRows.length === 0 ? (
            <div className="py-6">
              <EmptyState icon={<SearchX size={36} strokeWidth={1.5} />} title={t('noIssuesFound', lang)} />
            </div>
          ) : (
            <div className="py-3">
              <IssueResults issues={issueRows} lang={lang} />
            </div>
          ))}
        </div>

        {/* Правый рейл — панели (не растягиваем результаты во всю ширину) */}
        <aside className="hidden w-[300px] shrink-0 flex-col gap-4 pt-1 xl:flex">
          <div className="rounded-md border border-border bg-surface-2 p-3">
            <div className="mb-1.5 text-[12px] font-semibold text-ink">{t('proTip', lang)}</div>
            <p className="text-[12px] leading-relaxed text-muted">{t('proTipBody', lang)}</p>
            <div className="mt-2 wrap-break-word font-mono text-[11px] text-ink-2">
              by:handle · tag:redis · is:verified · type:ordered · stars:&gt;100
            </div>
          </div>
          {tags.length > 0 && (
            <div className="rounded-md border border-border bg-surface-2 p-3">
              <div className="mb-2 text-[12px] font-semibold text-ink">{t('popularTags', lang)}</div>
              <div className="flex flex-wrap gap-1.5">
                {tags.slice(0, 12).map((tg) => (
                  <Link
                    key={tg.tag}
                    href={`/search?q=${encodeURIComponent(`tag:${tg.tag}`)}`}
                    className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11.5px] text-ink-2 hover:text-ink"
                  >
                    {tg.tag}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </aside>
       </div>
      </section>
    </div>
  )
}
