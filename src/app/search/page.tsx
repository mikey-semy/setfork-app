import Link from 'next/link'
import { ChevronDown, SearchX, Sparkles, Users } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { hasAiEnvConfig } from '@/shared/settings/ai'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { FeedList } from '@/features/library/FeedList'
import { searchHref } from '@/features/library/search-href'
import { Pagination } from '@/shared/ui/Pagination'
import { pageCount, pageFromParam, pageWindow } from '@/shared/lib/paging'
import { AdvancedFacets } from '@/features/library/AdvancedFacets'
import { QualifierSearch } from '@/features/library/QualifierSearch'
import { ScopeSwitcher, type Scope } from '@/features/library/ScopeSwitcher'
import { startGeneration } from '@/features/generation/actions'
import { countLists, getSearchPage, getPopularTags, type FeedSort } from '@/features/library/queries'
import { countPeople, searchPeople, type PeopleSort } from '@/features/profile/search'
import { PeopleResults } from '@/features/profile/PeopleResults'
import { countIssues, searchIssues, type IssueStateFilter } from '@/features/issues/search'
import { IssueResults } from '@/features/issues/IssueResults'
import { parseSearchQuery } from '@/features/library/search-query'
import { PAGE } from '@/shared/ui/control'
import { cardClass } from '@/shared/ui/card-style'
import { TagChip } from '@/shared/ui/TagChip'

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

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('searchTitle', lang) }
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    tag?: string
    sort?: string
    e?: string
    type?: string
    scope?: string
    psort?: string
    state?: string
    focus?: string
    page?: string
  }>
}) {
  const sp = await searchParams
  // Номер страницы нужен ДО запроса — окно уезжает в него; потолок по числу найденного
  // считается тем же запросом счёта, что и бейдж scope-переключателя.
  const rawPage = Math.max(1, Number(sp.page) || 1)
  const aiOn = hasAiEnvConfig()
  const scope: Scope = sp.scope === 'people' ? 'people' : sp.scope === 'issues' ? 'issues' : 'lists'
  const sort = (SORTS.find((s) => s.key === sp.sort)?.key ?? 'trending') as FeedSort
  const peopleSort = (PEOPLE_SORTS.find((s) => s.key === sp.psort)?.key ?? 'followers') as PeopleSort
  const issueState = (ISSUE_STATES.find((s) => s.key === sp.state)?.key ?? 'open') as IssueStateFilter
  const type = sp.type === 'ordered' ? 'ordered' : sp.type === 'unordered' ? 'unordered' : undefined
  // Квалификаторы из строки поиска (by:/tag:/type:/stars:) + свободный текст.
  // `is:` снят вместе с публичным отбором «только проверенные» (решение 0006).
  const parsed = parseSearchQuery(sp.q ?? '')
  const typeQ = parsed.type ?? type
  const text = parsed.text.trim() || undefined
  // Генерируем СПИСОК только по свободному тексту-теме; чистые фильтры (by:/tag:) — нет.
  const canGenerate = aiOn && Boolean(text)

  const listOpts = {
    tag: sp.tag,
    q: text,
    ordered: typeQ ? typeQ === 'ordered' : undefined,
    by: parsed.by,
    tags: parsed.tags.length ? parsed.tags : undefined,
    minStars: parsed.minStars,
  }

  const [lang, session] = await Promise.all([getLang(), getSession()])
  // Бейджи scope-переключателя считаем всегда; полную выдачу — только активного scope.
  const [tags, counts, listsPage, people, issuesPage] = await Promise.all([
    getPopularTags(),
    Promise.all([countLists(listOpts, session?.userId), countPeople(text), countIssues(text, issueState)]).then(
      ([lists, ppl, iss]) => ({ lists, people: ppl, issues: iss }),
    ),
    scope === 'lists'
      ? getSearchPage({ ...listOpts, sort }, session?.userId, lang, pageWindow(rawPage))
      : Promise.resolve({ items: [], total: 0 }),
    scope === 'people' ? searchPeople({ q: text, sort: peopleSort }) : Promise.resolve([]),
    scope === 'issues' ? searchIssues({ q: text, state: issueState, window: pageWindow(rawPage) }) : Promise.resolve({ items: [], total: 0 }),
  ])
  // Выдача и её объём приезжают вместе: число страниц обязано считаться по ТОМУ ЖЕ
  // набору, который показан (см. getSearchPage).
  const feed = listsPage.items

  // Отдаёт ПОЛНЫЙ адрес, а не хвост запроса (см. features/library/search-href).
  const qs = (over: Record<string, string | undefined>) =>
    searchHref({ q: sp.q, tag: sp.tag, sort: sp.sort, type: sp.type }, over)
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
      {/* Заголовок страницы для диктора: видимого у этой страницы нет по замыслу,
          но без h1 человек не найдёт, где он оказался (WCAG 2.4.6, обход по заголовкам). */}
      <h1 className="sr-only">{t('searchTitle', lang)}</h1>
      <aside className="hidden w-panel shrink-0 border-r border-border bg-surface-2 px-3 py-5 lg:block">
        <ScopeSwitcher active={scope} counts={counts} q={sp.q} sort={sp.sort} lang={lang} basePath={BASE} />
        {/* List-специфичные фасеты — только для scope=lists */}
        {scope === 'lists' && <AdvancedFacets initialQ={sp.q ?? ''} tags={tags} lang={lang} basePath={BASE} />}
      </aside>

      <section className="min-w-0 flex-1">
       <div className={`${PAGE} flex gap-6`}>
        <div className="min-w-0 flex-1">
        {/* Поле поиска живёт НА СТРАНИЦЕ, а не в шапке: в шапке на мобильном оно
            сжималось до ~100px (рядом с лого, переключателем языка и «Войти») и было
            бесполезным, да и дублировать функцию страницы, на которой уже находишься,
            незачем. Здесь оно во всю ширину. */}
        <div className="mb-4">
          <QualifierSearch initial={sp.q ?? ''} scope={sp.scope} autoFocus={sp.focus === '1'} lang={lang} />
        </div>

        {/* Мобильный доступ к scope и фильтрам (сайдбар скрыт < lg) */}
        <div className="mb-3 lg:hidden">
          <ScopeSwitcher active={scope} counts={counts} q={sp.q} sort={sp.sort} lang={lang} basePath={BASE} orientation="horizontal" />
          {scope === 'lists' && (
            <details className="group mt-2 rounded-md border border-border bg-surface-2 px-3 py-2">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-body font-semibold text-ink-2">
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
          <div className="flex gap-4 text-body font-semibold">
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
          <span className="text-body-sm text-muted">
            {scope === 'lists' && `${counts.lists} ${t('ofLists', lang)}`}
            {scope === 'people' && `${counts.people} ${t('ofPeople', lang)}`}
            {scope === 'issues' && `${counts.issues} ${t('ofIssues', lang)}`}
          </span>
        </div>

        {sp.tag && scope === 'lists' && (
          <div className="mt-3 text-body text-ink-2">
            #{sp.tag}{' '}
            <Link href={qs({ tag: undefined })} className="text-accent hover:underline">
              ✕
            </Link>
          </div>
        )}
        {sp.e === 'aifail' && (
          <div className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-body text-danger">{t('aiFail', lang)}</div>
        )}
        {sp.e === 'ratelimited' && (
          <div className="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-body text-warn">{t('rateLimited', lang)}</div>
        )}

        {/* ── Lists ── */}
        {scope === 'lists' && (
          <>
            {canGenerate && feed.length === 0 && (
              <form action={startGeneration} className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-accent bg-accent-soft px-4 py-3">
                <Sparkles size={16} className="text-accent" />
                <span className="text-body text-ink">
                  {t('cantFind', lang)} <span className="font-semibold">“{parsed.text}”</span>
                </span>
                <input type="hidden" name="q" value={parsed.text} />
                <Button type="submit" variant="primary" size="md" className="ml-auto">
                  <Sparkles size={13} /> {t('generateWithAi', lang)}
                </Button>
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
              <>
                <FeedList items={feed} lang={lang} viewerId={session?.userId} className="space-y-3 py-3" />
                {/* Поиск — листалка, а не витрина: найденное за первой страницей обязано
                    оставаться достижимым, иначе счётчик обещает больше, чем можно открыть. */}
                <Pagination
                  // Число страниц — по ТОЙ ЖЕ выдаче, что и показана. `counts.lists` для
                  // этого не годится: он считает буквальные совпадения, а в гибридном
                  // режиме показывается ещё и смысловое — оно осталось бы за краем.
                  page={pageFromParam(sp.page, pageCount(listsPage.total))}
                  totalPages={pageCount(listsPage.total)}
                  // Число найденного важнее номера страницы там, где выдача отобрана:
                  // «сколько нашлось» — первый вопрос к результатам поиска.
                  total={listsPage.total}
                  // `qs` отдаёт УЖЕ готовый адрес со всеми действующими фильтрами — его и
                  // берём целиком. Подставить его как строку запроса значило бы собрать
                  // `/search?/search?q=…`, то есть ссылку в никуда.
                  makeHref={(p) => qs({ page: p > 1 ? String(p) : undefined })}
                  lang={lang}
                />
              </>
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
          (issuesPage.items.length === 0 ? (
            <div className="py-6">
              <EmptyState icon={<SearchX size={36} strokeWidth={1.5} />} title={t('noIssuesFound', lang)} />
            </div>
          ) : (
            <div className="py-3">
              <IssueResults issues={issuesPage.items} lang={lang} />
              {/* Та же листалка, что у списков: счётчик над выдачей и её объём считаются
                  по ОДНОМУ отбору, иначе цифра обещает страницы, которых нет. */}
              <Pagination
                page={pageFromParam(sp.page, pageCount(issuesPage.total))}
                totalPages={pageCount(issuesPage.total)}
                total={issuesPage.total}
                makeHref={(p) => scopeTab({ scope: 'issues', state: issueState, page: p > 1 ? String(p) : undefined })}
                lang={lang}
              />
            </div>
          ))}
        </div>

        {/* Правый рейл — панели (не растягиваем результаты во всю ширину) */}
        <aside className="hidden w-panel-lg shrink-0 flex-col gap-4 pt-1 xl:flex">
          <div className={cardClass({ tone: 'inset', pad: 'sm' })}>
            <div className="mb-1.5 text-body-sm font-semibold text-ink">{t('proTip', lang)}</div>
            <p className="text-body-sm leading-relaxed text-muted">{t('proTipBody', lang)}</p>
            <div className="mt-2 wrap-break-word font-mono text-caption text-ink-2">
              by:handle · tag:redis · type:ordered · stars:&gt;100
            </div>
          </div>
          {tags.length > 0 && (
            <div className={cardClass({ tone: 'inset', pad: 'sm' })}>
              <div className="mb-2 text-body-sm font-semibold text-ink">{t('popularTags', lang)}</div>
              <div className="flex flex-wrap gap-1.5">
                {tags.slice(0, 12).map((tg) => (
                  <TagChip key={tg.tag} slug={tg.tag} href={`/search?q=${encodeURIComponent(`tag:${tg.tag}`)}`} />
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
