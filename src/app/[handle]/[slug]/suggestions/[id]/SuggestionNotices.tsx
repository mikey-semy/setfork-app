import Link from 'next/link'
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
          mergedVersion={sug.mergedVersion}
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
      {/* СВЯЗЬ ОТКАТА — с обеих сторон. Схема обещает её прямо, поле в базе есть, а
          показать было некому: человек видел два несвязанных предложения с похожим
          текстом и сам догадывался, что одно отменяет другое. Так же устроено у
          GitHub: на revert-PR стоит «Reverts #123», на исходном — обратная ссылка. */}
      {sug.reverts?.number ? (
        <Alert variant="info" className="mb-3">
          <Link href={`/${owner}/${slug}/suggestions/${sug.reverts.number}`} className="text-accent hover:underline">
            {t('prReverts', lang).replace('{n}', String(sug.reverts.number))}
          </Link>
        </Alert>
      ) : null}
      {sug.revertedBy?.number ? (
        <Alert variant="info" className="mb-3">
          <Link href={`/${owner}/${slug}/suggestions/${sug.revertedBy.number}`} className="text-accent hover:underline">
            {t('prRevertedIn', lang).replace('{n}', String(sug.revertedBy.number))}
          </Link>
        </Alert>
      ) : null}
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
