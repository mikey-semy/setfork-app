import { Fragment } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GitBranch, GitCommitHorizontal } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Tooltip } from '@/shared/ui/Tooltip'
import { Alert } from '@/shared/ui/Alert'
import { requireViewableMeta } from '@/features/library/guard'
import { countCommits, getCommitAuthors, getCommitsPage } from '@/features/library/queries'
import { Pagination } from '@/shared/ui/Pagination'
import { AFTER_PARAM, BEFORE_PARAM, COMMITS_PER_PAGE, cursorHref, readCursor } from '@/shared/lib/paging'
import { CommitFilters } from '@/features/library/CommitFilters'
import { HistoryNav } from '@/widgets/HistoryNav'
import { CommitRow } from '@/features/library/CommitRow'
import { commitCutoff } from '@/features/library/commit-filter'
import { gitCore } from '@/features/git/core'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PAGE } from '@/shared/ui/control'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('versionsTab', lang)} · ${handle}/${slug}` }
}

// «Коммиты» списка (как история коммитов GitHub): версии сгруппированы по дате,
// строка = сообщение + автор (аватар/ник) + когда, плюс фильтры автор/дата (как
// «All users»/«All time»). Читаем прямым Postgres-запросом (getCommits), в обход
// домен-порта — независимо от Rust-read-пути.
export default async function CommitsPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ author?: string; since?: string; after?: string; before?: string; e?: string }>
}) {
  const [{ handle: owner, slug }, sp, lang] = await Promise.all([params, searchParams, getLang()])
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()

  // Фильтры уходят В ЗАПРОС вместе с окном. Отбирать показанную порцию нельзя: страница
  // отдавала бы «двадцать штук, из которых подошли три», а следующая начиналась бы не там,
  // где кончилась предыдущая.
  const author = sp.author || 'all'
  const since = sp.since || 'all'
  const cutoff = commitCutoff(since)
  // Ключ истории — НОМЕР ВЕРСИИ, целое; курсор от ленты сюда не подойдёт и честно отсеется.
  const { cursor, dir } = readCursor(sp, 'int')
  const [history, authors, total, branches] = await Promise.all([
    getCommitsPage(meta.id, COMMITS_PER_PAGE, cursor, dir, {
      authorHandle: author === 'all' ? undefined : author,
      since: cutoff ? new Date(cutoff) : undefined,
    }),
    // Авторы — по всей истории, а не по показанной порции: иначе фильтр по человеку
    // исчезал бы ровно тогда, когда его правок нет на текущей странице.
    getCommitAuthors(meta.id),
    // Число в шапке — по всему списку и без фильтров; раньше за него платили подъёмом
    // всей истории целиком.
    countCommits(meta.id),
    gitCore.listBranches({ owner, slug }).catch(() => [] as { name: string }[]),
  ])
  const filtered = history.items
  const base = `/${owner}/${slug}`
  const versionsBase = `${base}/versions`
  const branchCount = Math.max(1, branches.length) // как минимум main

  // Группировка по локальному дню (коммиты уже по убыванию версии).
  const dayFmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' })
  const groups: { day: string; items: typeof filtered }[] = []
  for (const c of filtered) {
    const day = dayFmt.format(new Date(c.createdAt))
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push(c)
    else groups.push({ day, items: [c] })
  }

  return (
    <div className={PAGE}>
      {/* Отказ отката — здесь, а не молча: действие начинается на этой странице,
          и ответ на него человек ждёт тоже здесь. */}
      {sp.e === 'outofsync' && (
        <Alert variant="danger" className="mb-4">
          <span className="block">{t('versionRestoreOutOfSync', lang)}</span>
        </Alert>
      )}
      <HistoryNav
        base={base}
        active="commits"
        canCompare={meta.currentVersion > 1}
        labels={{ commits: t('versionsTab', lang), releases: t('releasesLabel', lang), compare: t('compareTitle', lang) }}
      />
      {/* Шапка: ветка + счётчики слева, фильтры автор/дата справа (как GitHub Commits). */}
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.8125rem]">
          {/* Оставляем ИМЯ РЕФА main (его же пользователь набирает в git push
              origin main), а по-русски поясняем тултипом — UI не расходится с git. */}
          <Tooltip label={t('defaultBranchHint', lang)}>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 font-semibold text-ink">
              <GitBranch size={14} className="text-muted" /> main
            </span>
          </Tooltip>
          <span className="text-ink-2">
            <b className="text-ink">{total}</b> {t('commitsLabel', lang)}
          </span>
          <span className="inline-flex items-center gap-1 text-ink-2">
            <GitBranch size={13} className="text-muted" /> <b className="text-ink">{branchCount}</b> {t('branchesLabel', lang)}
          </span>
        </div>
        <div className="ml-auto">
          <CommitFilters
            base={versionsBase}
            authors={authors}
            author={author}
            since={since}
            labels={{
              allAuthors: t('allAuthors', lang),
              allTime: t('allTime', lang),
              lastDay: t('lastDay', lang),
              lastWeek: t('lastWeek', lang),
              lastMonth: t('lastMonth', lang),
              lastYear: t('lastYear', lang),
              byAuthor: t('filterByAuthor', lang),
              byDate: t('filterByDate', lang),
              reset: t('resetFilters', lang),
            }}
          />
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState hint={t('noCommitsMatch', lang)}>
          <Link href={versionsBase} className="text-[0.8125rem] font-semibold text-accent hover:underline">
            {t('resetFilters', lang)}
          </Link>
        </EmptyState>
      ) : (
        groups.map((g) => (
          <Fragment key={g.day}>
            {/* Заголовок-дата группы. */}
            <div className="mb-2 mt-4 flex items-center gap-2 text-[0.78125rem] font-medium text-ink-2 first:mt-0">
              <GitCommitHorizontal size={15} className="text-muted" /> {t('versionsTab', lang)} · {g.day}
            </div>
            {/* Ветвь-линия слева с узлами-точками; каждая строка — аккордеон (тап → дифф). */}
            <div className="ml-2 flex flex-col gap-2 border-l border-border pl-4">
              {g.items.map((c) => {
                const msg = c.note && !['seeded', 'initial', 'edit', 'ai draft'].includes(c.note) ? c.note : t('noCommitMessage', lang)
                return (
                  <CommitRow
                    key={c.id}
                    owner={owner}
                    slug={slug}
                    base={base}
                    version={c.version}
                    msg={msg}
                    createdAtMs={new Date(c.createdAt).getTime()}
                    isCurrent={c.version === meta.currentVersion}
                    author={c.author}
                    lang={lang}
                    labels={{
                      current: t('currentVersion', lang),
                      authorNotRecorded: t('authorNotRecorded', lang),
                      loading: t('loadingChanges', lang),
                      noChanges: t('diffNothing', lang),
                      loadFailed: t('list.diffLoadFailed', lang),
                      retry: t('tryAgain', lang),
                      fullCompare: t('compareTitle', lang),
                      viewVersion: t('viewVersion', lang),
                      expandHint: t('expandCommit', lang),
                    }}
                  />
                )
              })}
            </div>
          </Fragment>
        ))
      )}
      {/* Шаги истории. Фильтры автор/дата переносятся сами: cursorHref тащит остальные
          параметры и меняет ровно курсор. */}
      <Pagination
        lang={lang}
        steps={{
          prev: history.prev ? cursorHref(versionsBase, sp, BEFORE_PARAM)(history.prev) : null,
          next: history.next ? cursorHref(versionsBase, sp, AFTER_PARAM)(history.next) : null,
        }}
      />
    </div>
  )
}
