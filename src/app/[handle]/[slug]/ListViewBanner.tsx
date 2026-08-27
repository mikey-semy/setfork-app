import Link from 'next/link'
import { GitCommitHorizontal, GitPullRequest, History, Info, Tag } from 'lucide-react'
import { openBranchPr, revertToVersion } from '@/features/library/actions'
import { branchLabel } from '@/features/git/branch-label'
import { Button } from '@/shared/ui/button'
import { timeAgo } from '@/shared/ui/timeAgo'
import { t, type Lang } from '@/shared/i18n'
import type { ListPageData } from './load'
import { buttonClass } from '@/shared/ui/button-style'
import { Alert } from '@/shared/ui/Alert'
import { TextButton } from '@/shared/ui/TextButton'

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
        <Alert
          variant="warn"
          icon={GitCommitHorizontal}
          className="print:hidden"
          action={
            <>
              {viewer && branchInfo.ahead > 0 && (
                <form action={openBranchPr.bind(null, tpl.id, refBranch)}>
                  <Button type="submit">
                    <GitPullRequest size={12} /> {t('list.openPullRequest', lang)}
                  </Button>
                </form>
              )}
              <TextButton tone="accent" href={base} className="font-semibold">
                {t('backToMain', lang)}
              </TextButton>
            </>
          }
        >
          {t('list.branch', lang)} <b className="font-mono">{branchLabel(refBranch, lang)}</b> · +{branchInfo.ahead}/-{branchInfo.behind}{' '}
          {t('list.branchVsMain', lang)}
        </Alert>
      )}

      {/* Просмотр прошлой версии (?v=N): снимок только для чтения + возврат. */}
      {histVer && histNum && (
        <Alert
          variant="accent"
          icon={Tag}
          className="print:hidden"
          action={
            <>
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
            </>
          }
        >
          <span className="truncate">
            {t('list.version', lang)} <b>v{histNum}</b>
            <span className="hidden sm:inline">
              {' '}
              · {timeAgo(histVer.createdAt, lang)} ·{' '}
              {t('list.readOnlyCurrentV', lang).replace('{v}', String(curNum))}
            </span>
          </span>
        </Alert>
      )}

      {/* Результат поиска внутри списка (?find=). */}
      {find && (
        <Alert
          variant="accent"
          className="print:hidden"
          action={
            <TextButton tone="accent" href={base} className="font-semibold">
              {t('list.showAll', lang)}
            </TextButton>
          }
        >
          <b>{steps.length}</b> / {allSteps.length} {t('list.stepsMatch', lang)} <span className="font-mono">“{findRaw}”</span>
        </Alert>
      )}
    </>
  )
}
