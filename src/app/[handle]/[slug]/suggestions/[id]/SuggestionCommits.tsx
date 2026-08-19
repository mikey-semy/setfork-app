import Link from 'next/link'
import { buttonClass } from '@/shared/ui/button-style'
import { ArrowLeft } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { CommitsList } from '@/features/library/CommitsList'
import { CodeDiff, ListDiff } from '@/features/library/DiffViews'
import { DiffViewToggle } from '@/features/library/DiffViewToggle'
import type { loadSuggestionPage } from './load'

type Loaded = Awaited<ReturnType<typeof loadSuggestionPage>>

/**
 * Вкладка «Коммиты»: список коммитов ветки, а по выбору — дифф ОДНОГО коммита.
 *
 * Дифф коммита — тот же, что у всей правки, только стороны другие: этот коммит против
 * предыдущего В ЭТОЙ ЖЕ ветке (а у самого раннего — против main). Предыдущий берётся из
 * уже загруженного списка: спрашивать git о родителе значило бы второй поход за тем, что
 * уже на руках.
 */
export function SuggestionCommits({ owner, slug, lang, data }: { owner: string; slug: string; lang: Lang; data: Loaded }) {
  const { commits, commitAuthors, commitDiff, path, view, meta } = data
  if (!commits) return null

  if (!commitDiff) {
    return (
      <CommitsList
        commits={commits}
        authors={commitAuthors}
        lang={lang}
        diffBase={`${path}?tab=commits`}
        snapshotBase={`/${owner}/${slug}`}
        labels={{
          count: t('prCommitsCount', lang),
          empty: t('prCommitsEmpty', lang),
          merge: t('prCommitMerge', lang),
          diff: t('prCommitDiff', lang),
          openAt: t('prOpenAtCommit', lang),
        }}
      />
    )
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link
          href={`${path}?tab=commits`}
          className={buttonClass({ className: 'shrink-0' })}
        >
          <ArrowLeft size={14} /> <span className="max-sm:hidden">{t('prAllCommits', lang)}</span>
        </Link>
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold text-ink">{commitDiff.title}</span>
        <span className="shrink-0 font-mono text-[0.78125rem] text-muted">{commitDiff.sha.slice(0, 7)}</span>
        <div className="ml-auto max-sm:w-full max-sm:justify-end">
          <DiffViewToggle path={path} commit={commitDiff.sha} tab="commits" view={view} labels={{ code: t('viewCode', lang), list: t('viewList', lang) }} />
        </div>
      </div>
      {view === 'code' ? (
        <CodeDiff fromSteps={commitDiff.from} toSteps={commitDiff.to} ordered={meta.ordered} lang={lang} />
      ) : (
        <ListDiff fromSteps={commitDiff.from} toSteps={commitDiff.to} lang={lang} />
      )}
    </>
  )
}
