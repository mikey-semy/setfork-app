import { Fragment } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GitBranch, GitCommitHorizontal, GitCompare } from 'lucide-react'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { requireViewableMeta } from '@/features/library/guard'
import { getCommits } from '@/features/library/queries'
import { CommitFilters } from '@/features/library/CommitFilters'
import { CommitRow } from '@/features/library/CommitRow'
import { commitCutoff } from '@/features/library/commit-filter'
import { gitCore } from '@/features/git/core'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  return { title: `Commits · ${handle}/${slug}` }
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
  searchParams: Promise<{ author?: string; since?: string }>
}) {
  const [{ handle: owner, slug }, sp, lang] = await Promise.all([params, searchParams, getLang()])
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  const [commits, branches] = await Promise.all([
    getCommits(meta.id),
    gitCore.listBranches({ owner, slug }).catch(() => [] as { name: string }[]),
  ])
  const base = `/${owner}/${slug}`
  const versionsBase = `${base}/versions`
  const branchCount = Math.max(1, branches.length) // как минимум main

  // Список авторов для дропдауна (по всем коммитам, а не по отфильтрованным).
  const authorMap = new Map<string, string | null>()
  for (const c of commits) if (c.author) authorMap.set(c.author.handle, c.author.name)
  const authors = [...authorMap].map(([handle, name]) => ({ handle, name }))

  // Применяем фильтры автор/дата.
  const author = sp.author || 'all'
  const since = sp.since || 'all'
  const cutoff = commitCutoff(since)
  const filtered = commits.filter(
    (c) =>
      (author === 'all' || c.author?.handle === author) &&
      (!cutoff || new Date(c.createdAt).getTime() >= cutoff),
  )

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
    <div className="mx-auto w-full max-w-[900px] px-4 py-6">
      {/* Шапка: ветка + счётчики слева, фильтры автор/дата справа (как GitHub Commits). */}
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 font-semibold text-ink">
            <GitBranch size={14} className="text-muted" /> main
          </span>
          <span className="text-ink-2">
            <b className="text-ink">{commits.length}</b> {t('commitsLabel', lang)}
          </span>
          <span className="inline-flex items-center gap-1 text-ink-2">
            <GitBranch size={13} className="text-muted" /> <b className="text-ink">{branchCount}</b> {t('branchesLabel', lang)}
          </span>
          {meta.currentVersion > 1 && (
            <Link href={`${base}/compare`} className="inline-flex items-center gap-1.5 text-ink-2 hover:text-accent">
              <GitCompare size={14} /> {t('compareTitle', lang)}
            </Link>
          )}
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
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-[13px] text-muted">
          {t('noCommitsMatch', lang)}
          <div className="mt-3">
            <Link href={versionsBase} className="text-accent hover:underline">
              {t('resetFilters', lang)}
            </Link>
          </div>
        </div>
      ) : (
        groups.map((g) => (
          <Fragment key={g.day}>
            {/* Заголовок-дата группы. */}
            <div className="mb-2 mt-4 flex items-center gap-2 text-[12.5px] font-medium text-ink-2 first:mt-0">
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
                      fullCompare: t('compareTitle', lang),
                      expandHint: t('expandCommit', lang),
                    }}
                  />
                )
              })}
            </div>
          </Fragment>
        ))
      )}
    </div>
  )
}
