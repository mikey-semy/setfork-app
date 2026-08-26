import Link from 'next/link'
import { buttonClass } from '@/shared/ui/button-style'
import { type ReactNode } from 'react'
import { Eye, Pencil } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { CodeDiff, ListDiff } from '@/features/library/DiffViews'
import { DiffViewToggle } from '@/features/library/DiffViewToggle'
import { PendingReviewBar } from '@/features/library/PendingReviewBar'
import { submitPendingComments } from '@/features/comments/actions'
import type { loadSuggestionPage } from './load'

type Loaded = Awaited<ReturnType<typeof loadSuggestionPage>>

/**
 * Вкладка «Изменения»: сам дифф, прогресс просмотра, обсуждения по блокам и отправка
 * накопленных замечаний. Меняется вместе с тем, КАК читают правку, — в отличие от
 * вкладки «Итог», которая показывает результат.
 */
export function SuggestionFiles({
  owner,
  slug,
  lang,
  viewerId,
  data,
  reviewPanel,
}: {
  owner: string
  slug: string
  lang: Lang
  viewerId?: string
  data: Loaded
  /** Панель ревью: та же самая, что в обсуждении, — приходит от страницы. */
  reviewPanel: ReactNode
}) {
  const { sug, meta, path, view, baseCmp, propCmp, canEditItems, viewedMarks, markable, viewedCount, threadsByBlock, myPending } = data
  const open = sug.status === 'open'
  return (
    <>
      <div className="mb-1.5 text-caption font-semibold uppercase tracking-[0.07em] text-muted">
        {t('proposedChanges', lang)} · {t('pr.baseToSuggestion', lang).replace('{v}', String(sug.baseVersion))}
      </div>
      {/* Ряд действий над диффом: слева прогресс ревью, справа правка и
          переключатель вида — одной высоты (эталон настроек). */}
      <div className="mb-3 flex items-center justify-end gap-2">
        {/* Прогресс — только своему ревьюеру и только когда есть что отмечать.
            На мобиле остаются цифры, слово прячется: оно предсказуемо. */}
        {viewedMarks && open && markable > 0 && (
          <span className="mr-auto inline-flex items-center gap-1.5 text-body-sm text-ink-2">
            <Eye size={14} className={viewedCount === markable ? 'text-ok' : 'text-muted'} />
            <span className="font-mono">
              {viewedCount}/{markable}
            </span>
            <span className="max-sm:hidden">{t('prViewedProgress', lang)}</span>
          </span>
        )}
        {canEditItems && (
          <Link
            href={`${path}/edit`}
            className={buttonClass({ className: 'shrink-0' })}
          >
            <Pencil size={14} /> {t('prEdit', lang)}
          </Link>
        )}
        <DiffViewToggle path={path} tab="files" view={view} labels={{ code: t('viewCode', lang), list: t('viewList', lang) }} />
      </div>

      {view === 'code' ? (
        <CodeDiff fromSteps={baseCmp} toSteps={propCmp} ordered={meta.ordered} lang={lang} />
      ) : (
        <ListDiff
          fromSteps={baseCmp}
          toSteps={propCmp}
          lang={lang}
          viewed={
            viewedMarks && open
              ? {
                  suggestionId: sug.id,
                  marks: viewedMarks,
                  labels: { mark: t('prViewedMark', lang), unmark: t('prViewedUnmark', lang), stale: t('prViewedStale', lang) },
                }
              : null
          }
          comments={{
            owner,
            slug,
            suggestionId: sug.id,
            canComment: !!viewerId && open,
            canApply: canEditItems,
            byBlock: threadsByBlock,
            labels: {
              add: t('commentAdd', lang),
              placeholder: t('commentPlaceholder', lang),
              send: t('commentSend', lang),
              startReview: t('prStartReview', lang),
              pendingBadge: t('prPendingBadge', lang),
              cancel: t('commentCancel', lang),
              reply: t('commentReply', lang),
              resolve: t('commentResolve', lang),
              unresolve: t('commentUnresolve', lang),
              resolved: t('commentResolvedCount', lang),
              onSelection: t('commentOnSelection', lang),
              onBlock: t('commentOnBlock', lang),
              stateReanchored: t('commentReanchored', lang),
              orphanHint: t('commentOrphaned', lang),
              outdated: t('prThreadOutdated', lang),
              toIssue: t('prThreadToIssue', lang),
              suggestLabel: t('prSuggestEdit', lang),
              suggestHint: t('prSuggestHint', lang),
              suggestPh: t('prSuggestPh', lang),
              apply: t('prApply', lang),
              applied: t('prApplied', lang),
            },
          }}
        />
      )}

      <PendingReviewBar
        count={myPending}
        action={submitPendingComments.bind(null, owner, slug, sug.id)}
        labels={{ pending: t('prPendingReview', lang), submit: t('prSubmitReview', lang) }}
      />

      {reviewPanel}
    </>
  )
}
