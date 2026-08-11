import { t, type Lang } from '@/shared/i18n'
import { Alert } from '@/shared/ui/Alert'
import { MergedPanel } from '@/features/library/MergedPanel'
import { branchLabel } from '@/features/git/branch-label'
import type { loadSuggestionPage } from './load'

type Loaded = Awaited<ReturnType<typeof loadSuggestionPage>>

/**
 * Плашки над вкладками: чем кончилось предложение, почему не удалось слить и не
 * исчезла ли ветка под ним. Одна причина менять — что мы сообщаем о СУДЬБЕ правки.
 */
export function SuggestionNotices({ owner, slug, lang, data }: { owner: string; slug: string; lang: Lang; data: Loaded }) {
  const { sug, canMerge, branchMissing, mergeErr } = data
  return (
    <>
      {sug.status !== 'open' && (
        <MergedPanel
          owner={owner}
          slug={slug}
          branch={sug.status === 'accepted' && sug.branchRef && !branchMissing && canMerge ? sug.branchRef : null}
          // Откат предлагаем только мейнтейнеру и только у принятого: отменять
          // отклонённое нечего, а версия слияния нужна, чтобы знать ЧТО отменять.
          revertOf={sug.status === 'accepted' && canMerge && sug.mergedVersion ? sug.id : null}
          accepted={sug.status === 'accepted'}
          labels={{
            merged: t('prMerged', lang),
            closed: t('prClosed', lang),
            branchSafeToDelete: t('prBranchSafeDelete', lang),
            deleteBranch: t('prDeleteBranch', lang),
            branchDeleted: t('prBranchDeleted', lang),
            deleteFailed: t('prDeleteFailed', lang),
            revert: t('prRevert', lang),
            revertBlocked: t('prRevertBlocked', lang),
          }}
        />
      )}
      {mergeErr && (
        <Alert variant="danger" className="mb-3">
          {t(mergeErr, lang)}
        </Alert>
      )}
      {branchMissing && (
        <Alert variant="warn" className="mb-3">
          {t('pr.branchDeletedStale', lang).replace('{branch}', branchLabel(sug.branchRef!, lang))}
        </Alert>
      )}
    </>
  )
}
