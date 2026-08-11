import { t, type Lang } from '@/shared/i18n'
import { ReviewPanel } from '@/features/library/ReviewPanel'
import type { loadSuggestionPage } from './load'

type Loaded = Awaited<ReturnType<typeof loadSuggestionPage>>

/**
 * Панель ревью. Одна и та же в «Изменениях» и в «Обсуждении» — поэтому собирается
 * здесь и передаётся обеим вкладкам: иначе набор из четырнадцати подписей пришлось бы
 * держать в двух местах и следить, чтобы они не разъехались.
 *
 * У закрытого предложения ревью нет: решение уже принято.
 */
export function SuggestionReview({ lang, viewerId, data }: { lang: Lang; viewerId?: string; data: Loaded }) {
  const { sug, reviews, myVerdict, canMerge } = data
  if (sug.status !== 'open') return null
  return (
    <div className="mt-3">
      <ReviewPanel
        suggestionId={sug.id}
        reviews={reviews}
        myVerdict={myVerdict}
        canReview={!!viewerId}
        canDismiss={canMerge}
        isAuthor={viewerId === sug.authorId}
        lang={lang}
        labels={{
          title: t('reviewTitle', lang),
          approve: t('reviewApprove', lang),
          requestChanges: t('reviewRequestChanges', lang),
          commentOnly: t('reviewCommentOnly', lang),
          placeholder: t('reviewPlaceholder', lang),
          send: t('commentSend', lang),
          withdraw: t('reviewWithdraw', lang),
          blocked: t('reviewBlocked', lang),
          yourReview: t('reviewYours', lang),
          ownAuthor: t('reviewOwnAuthor', lang),
          dismiss: t('reviewDismiss', lang),
          dismissReason: t('reviewDismissReason', lang),
          dismissedBy: t('reviewDismissedBy', lang),
        }}
      />
    </div>
  )
}
