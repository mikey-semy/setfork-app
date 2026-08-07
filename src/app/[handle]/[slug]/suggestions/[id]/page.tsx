import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Check, Eye, GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Pencil, RefreshCw, X } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, type TKey } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { Badge, type BadgeVariant } from '@/shared/ui/badge'
import { Tooltip } from '@/shared/ui/Tooltip'
import { Markdown } from '@/shared/ui/Markdown'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { Alert } from '@/shared/ui/Alert'
import { MarkdownEditor } from '@/shared/ui/MarkdownEditor'
import { loadSuggestionPage } from './load'
import { SuggestionAside } from './SuggestionAside'
import { SuggestionConversation } from './SuggestionConversation'
import { requireViewableMeta } from '@/features/library/guard'
import { acceptSuggestion, addSuggestionComment, mergeBranchPr, rejectSuggestion, resolveBranchPr, updateBranchFromMain } from '@/features/library/actions'
import { canEditSuggestionItems } from '@/features/library/suggestion-perms'
import { ConflictResolver } from '@/features/git/ConflictResolver'
import { threeWayMerge } from '@/features/git/three-way'
import { isCollaborator } from '@/features/collab/queries'
import { gitCore } from '@/features/git/core'
import { branchLabel } from '@/features/git/branch-label'
import { snapshotSteps } from '@/features/git/snapshot-steps'
import { CodeDiff, ListDiff } from '@/features/library/DiffViews'
import { diffSteps, rowsToCmp } from '@/features/library/diff'
import { DiffViewToggle } from '@/features/library/DiffViewToggle'
import { SuggestionResult } from '@/features/library/SuggestionResult'
import { SuggestionTabs, type SuggestionTab } from '@/features/library/SuggestionTabs'
import { SuggestionTitle } from '@/features/library/SuggestionTitle'
import { ChecksList } from '@/features/library/ChecksList'
import { CommitsList } from '@/features/library/CommitsList'
import { DraftToggle } from '@/features/library/DraftToggle'
import { PendingReviewBar } from '@/features/library/PendingReviewBar'
import { reportedChecks, suggestionChecks } from '@/features/library/suggestion-checks'
import { withPrDefaults } from '@/features/library/pr-settings'
import { blocksFrom } from '@/features/library/suggestion-blocks'
import { blockFingerprint, isStaleMark } from '@/features/library/viewed-fingerprint'
import { closingRefs } from '@/features/library/closing-refs'
import { LinkIssuePicker } from '@/features/library/LinkIssuePicker'
import { LockToggle } from '@/features/library/LockToggle'
import { MergedPanel } from '@/features/library/MergedPanel'
import { SuggestionTimeline, type TimelineEvent } from '@/features/library/SuggestionTimeline'
import { AsideCard, PageAside } from '@/shared/ui/PageAside'
import { DiffStat } from '@/shared/ui/DiffStat'
import { ReviewPanel } from '@/features/library/ReviewPanel'
import { getSuggestionThreads } from '@/features/comments/queries'
import { submitPendingComments } from '@/features/comments/actions'
import { threadState } from '@/features/comments/state'
import type { RowThread } from '@/features/library/DiffComments'
import type { AnchorableBlock } from '@/features/comments/fields'
import { getSuggestionReviews } from '@/features/library/review-queries'
import { getReactionsFor } from '@/features/reactions/queries'
import { Reactions } from '@/features/reactions/Reactions'
import { CommentCard } from '@/features/collab/CommentCard'
import { CommentActions } from '@/features/collab/CommentActions'
import { WatchButton } from '@/features/watch/WatchButton'
import { AssigneePicker } from '@/features/issues/AssigneePicker'
import { LabelEditor } from '@/features/issues/LabelEditor'
import { MilestonePicker } from '@/features/issues/MilestonePicker'
import { getListLabels, getOpenIssuesForPicker } from '@/features/issues/queries'
import { getMilestonesForPicker } from '@/features/milestones/queries'
import { getIssuesByNumbers, getSuggestionAssignees, getSuggestionMilestone, getSuggestionReviewRequests, getUsersByEmails, getUsersByIds, getViewedMarks } from '@/features/library/queries'
import { setSuggestionDraft, setSuggestionLabels, setSuggestionMilestone, toggleReviewRequest, toggleSuggestionAssignee } from '@/features/library/suggestion-meta-actions'
import { getWatchCount, getWatchState } from '@/features/watch/queries'
import type { ProposedItem } from '@/shared/db'
import { isAdminHandle } from '@/shared/auth/admin'
import { PAGE } from '@/shared/ui/control'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string; id: string }> }) {
  const [{ handle, slug }, lang] = await Promise.all([params, getLang()])
  return { title: `${t('suggestionHeading', lang)} · ${handle}/${slug}` }
}

export default async function SuggestionThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string; id: string }>
  searchParams: Promise<{ e?: string; tab?: string; view?: string; commit?: string }>
}) {
  const [{ handle: owner, slug, id }, sp, lang, session] = await Promise.all([params, searchParams, getLang(), getSession()])
  const loaded = await loadSuggestionPage({ owner, slug, id, sp, lang, session })
  const {
    comments,
    sugR,
    cmtR,
    reviews,
    watchState,
    watchCount,
    assignees,
    reviewRequests,
    customLabels,
    msOptions,
    curMilestone,
    meta,
    sug,
    path,
    isOwner,
    canMerge,
    canEditItems,
    branchMissing,
    items,
    diffBase,
    threadsByBlock,
    linkedIssues,
    canLinkIssues,
    openIssues,
    myPending,
    myVerdict,
    threeWay,
    branchBehind,
    hasConflicts,
    mergeErr,
    sugPeople,
    fmt,
    isDraft,
    statusLabel,
    tab,
    view,
    baseCmp,
    propCmp,
    summary,
    changedCount,
    threadCount,
    timeline,
    prs,
    checks,
    checksFailed,
    viewedMarks,
    markable,
    viewedCount,
    commits,
    commitAuthors,
    commitDiff,
    coauthors,
    statusVariant,
    blockReasons,
  } = loaded

  const reviewPanel =
    sug.status === 'open' ? (
      <div className="mt-3">
        <ReviewPanel
          suggestionId={sug.id}
          reviews={reviews}
          myVerdict={myVerdict}
          canReview={!!session}
          canDismiss={canMerge}
          isAuthor={session?.userId === sug.authorId}
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
    ) : null

  return (
    <>
      <div className={PAGE}>
        {/* Шапка PR: сообщение правки как заголовок + номер #N. Номер — адрес для
            людей: /suggestions/12 работает наравне с uuid (getSuggestion берёт оба). */}
        <SuggestionTitle
          note={sug.note || t('noCommitMessage', lang)}
          number={sug.number}
          path={path}
          suggestionId={sug.id}
          canEdit={!!session && (session.userId === sug.authorId || session.userId === meta.ownerId)}
          labels={{
            edit: t('cmEdit', lang),
            save: t('cmSave', lang),
            cancel: t('commentCancel', lang),
            placeholder: t('prTitlePlaceholder', lang),
          }}
        />
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {/* Крупнее рядового чипа (это главный статус страницы), но той же
              тихой палитры. */}
          <Badge variant={statusVariant} className="px-3 py-1 text-[0.78125rem]">
            {sug.status === 'accepted' ? (
              <GitMerge size={14} />
            ) : sug.status === 'rejected' ? (
              <GitPullRequestClosed size={14} />
            ) : isDraft ? (
              <GitPullRequestDraft size={14} />
            ) : (
              <GitPullRequest size={14} />
            )}{' '}
            {statusLabel}
          </Badge>
          {/* Объём правки в шапке — тот же индикатор, что в диффе и в коммитах. */}
          <DiffStat counts={summary} squares />
          <span className="text-[0.8125rem] text-ink-2">
            {t('proposedBy', lang)}{' '}
            <Link href={`/${sug.author.handle}`} className="font-semibold text-ink hover:text-accent">
              {sug.author.handle}
            </Link>
            {/* Соавторы: над правкой работают несколько человек, и «предложил X»
                в одиночку это скрывало. У ветки вклад берём из авторства коммитов,
                у старых предложений — из тех, кто правил пункты. */}
            {coauthors.length > 0 && (
              <>
                {' '}
                <Tooltip label={`${t('prCoauthors', lang)}: ${coauthors.map((c) => c.handle).join(', ')}`}>
                  <span className="inline-flex shrink-0 items-center gap-0.5 align-middle">
                    {coauthors.slice(0, 3).map((c) => (
                      <Avatar key={c.handle} handle={c.handle} avatarUrl={c.avatarUrl} size={18} />
                    ))}
                    {coauthors.length > 3 && <span className="font-mono text-[0.6875rem] text-muted">+{coauthors.length - 3}</span>}
                  </span>
                </Tooltip>
              </>
            )}{' '}
            · {fmt.format(new Date(sug.createdAt))} ·{' '}
            {sug.branchRef ? (
              <>
                <Link href={`/${owner}/${slug}?ref=${encodeURIComponent(sug.branchRef)}`} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[0.78125rem] text-ink hover:text-accent">
                  <GitBranch size={11} /> {branchLabel(sug.branchRef, lang)}
                </Link>{' '}
                → <Tooltip label={t('defaultBranchHint', lang)}><span className="font-mono text-[0.78125rem]">main</span></Tooltip>
              </>
            ) : (
              <>{lang === 'ru' ? `на основе v${sug.baseVersion}` : `based on v${sug.baseVersion}`}</>
            )}
          </span>
        </div>

        <SuggestionTabs
          path={path}
          active={tab}
          conversationCount={threadCount}
          commitsCount={commits ? commits.length : null}
          filesCount={changedCount}
          checksFailed={checksFailed}
          labels={{
            conversation: t('conversationTab', lang),
            commits: t('versionsTab', lang),
            checks: t('checksTab', lang),
            files: t('proposedChanges', lang),
            result: t('resultTab', lang),
          }}
          arrows={{ prev: t('scrollPrev', lang), next: t('scrollNext', lang) }}
        />

        {/* Две колонки: содержимое вкладки + боковая панель (общий примитив). */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
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
            {lang === 'ru'
              ? `Ветка «${branchLabel(sug.branchRef!, lang)}» удалена — предложение неактуально, можно только отклонить.`
              : `Branch “${branchLabel(sug.branchRef!, lang)}” was deleted — this PR is stale and can only be closed.`}
          </Alert>
        )}

        {tab === 'commits' && commits && !commitDiff && (
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
        )}

        {/* ДИФФ ОДНОГО КОММИТА. Тот же дифф, что у всей правки, только стороны
            другие: этот коммит против предыдущего В ЭТОЙ ЖЕ ветке (а у самого
            раннего — против main). Предыдущий берём из уже загруженного списка
            коммитов: спрашивать git о родителе значило бы второй поход за тем,
            что уже на руках. */}
        {tab === 'commits' && commitDiff && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Link
                href={`${path}?tab=commits`}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-[0.78125rem] font-semibold text-ink hover:border-border-strong"
              >
                <ArrowLeft size={14} /> <span className="max-sm:hidden">{t('prAllCommits', lang)}</span>
              </Link>
              <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold text-ink">{commitDiff.title}</span>
              <span className="shrink-0 font-mono text-[0.78125rem] text-muted">{commitDiff.sha.slice(0, 7)}</span>
              <div className="ml-auto max-sm:w-full max-sm:justify-end">
                <DiffViewToggle
                  path={path}
                  commit={commitDiff.sha}
                  tab="commits"
                  view={view}
                  labels={{ code: t('viewCode', lang), list: t('viewList', lang) }}
                />
              </div>
            </div>
            {view === 'code' ? (
              <CodeDiff fromSteps={commitDiff.from} toSteps={commitDiff.to} ordered={meta.ordered} lang={lang} />
            ) : (
              <ListDiff fromSteps={commitDiff.from} toSteps={commitDiff.to} lang={lang} />
            )}
          </>
        )}

        {tab === 'checks' && (
          <ChecksList items={checks} labels={{ blocking: t('checksBlocking', lang), allGood: t('checksAllGood', lang), details: t('checksDetails', lang) }} />
        )}

        {tab === 'files' && (<>
        <div className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.07em] text-muted">
          {t('proposedChanges', lang)} · {lang === 'ru' ? `v${sug.baseVersion} → предложение` : `v${sug.baseVersion} → suggestion`}
        </div>
        {/* Ряд действий над диффом: слева прогресс ревью, справа правка и
            переключатель вида — одной высоты (эталон настроек). */}
        <div className="mb-3 flex items-center justify-end gap-2">
          {/* Прогресс — только своему ревьюеру и только когда есть что отмечать.
              На мобиле остаются цифры, слово прячется: оно предсказуемо. */}
          {viewedMarks && sug.status === 'open' && markable > 0 && (
            <span className="mr-auto inline-flex items-center gap-1.5 text-[0.78125rem] text-ink-2">
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
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-[0.78125rem] font-semibold text-ink hover:border-border-strong"
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
              viewedMarks && sug.status === 'open'
                ? {
                    suggestionId: sug.id,
                    marks: viewedMarks,
                    labels: {
                      mark: t('prViewedMark', lang),
                      unmark: t('prViewedUnmark', lang),
                      stale: t('prViewedStale', lang),
                    },
                  }
                : null
            }
            comments={{
              owner,
              slug,
              suggestionId: sug.id,
              canComment: !!session && sug.status === 'open',
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
        </>)}

        {/* ИТОГ: каким станет список, если предложение принять. Решение принимают по
            результату, а не по плюсам и минусам — именно поэтому предложения от
            компании копились непринятыми: посмотреть результат было негде. */}
        {tab === 'result' && (
          <>
            <div className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.07em] text-muted">
              {t('resultTab', lang)} · {lang === 'ru' ? `станет v${meta.currentVersion + 1}` : `becomes v${meta.currentVersion + 1}`}
            </div>
            <SuggestionResult items={items} lang={lang} ordered={meta.ordered} />
          </>
        )}

        {/* Обсуждение — вкладка по умолчанию. Заметка правки и ревью видны здесь,
            чтобы разговор шёл при полном контексте, как в Conversation у GitHub. */}
        {tab === 'conversation' && (
          <SuggestionConversation owner={owner} slug={slug} lang={lang} session={session} data={loaded} reviewPanel={reviewPanel} />
        )}
          </div>

          <SuggestionAside owner={owner} slug={slug} lang={lang} session={session} data={loaded} />
        </div>
      </div>
    </>
  )
}
