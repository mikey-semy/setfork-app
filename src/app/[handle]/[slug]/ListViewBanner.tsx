import Link from 'next/link'
import { GitCommitHorizontal, GitPullRequest, History, Info, Tag } from 'lucide-react'
import { openBranchPr, revertToVersion } from '@/features/library/actions'
import { branchLabel } from '@/features/git/branch-label'
import { Button } from '@/shared/ui/button'
import { timeAgo } from '@/shared/ui/timeAgo'
import { t, type Lang } from '@/shared/i18n'
import type { ListPageData } from './load'
import { buttonClass } from '@/shared/ui/button-style'

type Props = Pick<
  ListPageData,
  | 'base'
  | 'tpl'
  | 'viewer'
  | 'refCommit'
  | 'snapshot'
  | 'refBranch'
  | 'branchInfo'
  | 'histVer'
  | 'histNum'
  | 'curNum'
  | 'canManageBranches'
  | 'find'
  | 'findRaw'
  | 'steps'
  | 'allSteps'
> & { lang: Lang }

/**
 * Плашка «вы смотрите не текущий список»: снимок на коммите, черновик ветки, прошлая
 * версия или отфильтрованная поиском выдача. У всех четырёх одна работа — назвать,
 * ЧТО именно показано вместо main, и дать дорогу обратно; поэтому они живут вместе.
 */
export function ListViewBanner({
  base,
  tpl,
  viewer,
  refCommit,
  snapshot,
  refBranch,
  branchInfo,
  histVer,
  histNum,
  curNum,
  canManageBranches,
  find,
  findRaw,
  steps,
  allSteps,
  lang,
}: Props) {
  return (
    <>
      {/* Просмотр «на коммите»: снимок списка, каким он был тогда. Отдельная
          плашка, а не ветковая: у коммита нет ahead/behind, и предлагать
          «открыть pull request» с исторического снимка бессмысленно. */}
      {refCommit && snapshot && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-body-sm text-ink print:hidden">
          <GitCommitHorizontal size={13} className="shrink-0 text-muted" />
          <span className="min-w-0">
            {t('viewingAtCommit', lang)} <b className="font-mono">{refCommit.slice(0, 7)}</b>
          </span>
          <Link href={base} className="ml-auto font-semibold text-accent hover:underline">
            {t('backToMain', lang)}
          </Link>
        </div>
      )}

      {/* Просмотр «на ветке» (A1 read-only): черновик без версий. */}
      {refBranch && branchInfo && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-body-sm text-ink print:hidden">
          <GitCommitHorizontal size={13} className="shrink-0 text-warn" />
          <span>
            {t('list.branch', lang)} <b className="font-mono">{branchLabel(refBranch, lang)}</b> · +{branchInfo.ahead}/-{branchInfo.behind}{' '}
            {t('list.branchVsMain', lang)}
          </span>
          <span className="ml-auto flex items-center gap-3">
            {viewer && branchInfo.ahead > 0 && (
              <form action={openBranchPr.bind(null, tpl.id, refBranch)}>
                <button
                  type="submit"
                  className={buttonClass()}
                >
                  <GitPullRequest size={12} /> {t('list.openPullRequest', lang)}
                </button>
              </form>
            )}
            <Link href={base} className="font-semibold text-accent hover:underline">
              {t('backToMain', lang)}
            </Link>
          </span>
        </div>
      )}

      {/* Просмотр прошлой версии (?v=N): снимок только для чтения + возврат. */}
      {histVer && histNum && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-accent/50 bg-accent/10 px-3 py-2 text-body-sm text-ink print:hidden">
          <Tag size={13} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">
            {t('list.version', lang)} <b>v{histNum}</b>
            <span className="hidden sm:inline">
              {' '}
              · {timeAgo(histVer.createdAt, lang)} ·{' '}
              {t('list.readOnlyCurrentV', lang).replace('{v}', String(curNum))}
            </span>
          </span>
          <span className="flex items-center gap-2 max-sm:w-full max-sm:justify-end">
            {canManageBranches && (
              <form action={revertToVersion.bind(null, tpl.id, histNum)}>
                <Button type="submit" variant="primary">
                  <History size={13} />
                  <span className="max-sm:hidden">{t('list.restoreVersion', lang)}</span>
                  <span className="sm:hidden">{t('list.restore', lang)}</span>
                </Button>
              </form>
            )}
            <Link href={base}>
              <Button variant="outline">{t('list.toV', lang).replace('{v}', String(curNum))}</Button>
            </Link>
          </span>
        </div>
      )}

      {/* Результат поиска внутри списка (?find=). */}
      {find && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-accent/50 bg-accent-soft px-3 py-2 text-body-sm text-ink print:hidden">
          <Info size={13} className="shrink-0 text-accent" />
          <span>
            <b>{steps.length}</b> / {allSteps.length} {t('list.stepsMatch', lang)} <span className="font-mono">“{findRaw}”</span>
          </span>
          <Link href={base} className="ml-auto font-semibold text-accent hover:underline">
            {t('list.showAll', lang)}
          </Link>
        </div>
      )}
    </>
  )
}
