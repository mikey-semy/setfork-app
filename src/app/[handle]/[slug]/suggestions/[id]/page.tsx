import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Check, GitBranch, GitMerge, GitPullRequest, X } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { Tooltip } from '@/shared/ui/Tooltip'
import { Markdown } from '@/shared/ui/Markdown'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { MarkdownEditor } from '@/shared/ui/MarkdownEditor'
import { getSuggestion, getSuggestionComments, getVersionSteps } from '@/features/library/queries'
import { requireViewableMeta } from '@/features/library/guard'
import { acceptSuggestion, addSuggestionComment, mergeBranchPr, rejectSuggestion, resolveBranchPr } from '@/features/library/actions'
import { ConflictResolver } from '@/features/git/ConflictResolver'
import { threeWayMerge } from '@/features/git/three-way'
import { isCollaborator } from '@/features/collab/queries'
import { gitCore } from '@/features/git/core'
import { CodeDiff, ListDiff } from '@/features/library/DiffViews'
import { diffSteps, rowsToCmp } from '@/features/library/diff'
import { DiffViewToggle } from '@/features/library/DiffViewToggle'
import { SuggestionTabs, type SuggestionTab } from '@/features/library/SuggestionTabs'
import { SuggestionTitle } from '@/features/library/SuggestionTitle'
import { MergedPanel } from '@/features/library/MergedPanel'
import { SuggestionTimeline, type TimelineEvent } from '@/features/library/SuggestionTimeline'
import { AsideCard, PageAside } from '@/shared/ui/PageAside'
import { ReviewPanel } from '@/features/library/ReviewPanel'
import { getSuggestionThreads } from '@/features/comments/queries'
import { threadState } from '@/features/comments/state'
import type { RowThread } from '@/features/library/DiffComments'
import type { AnchorableBlock } from '@/features/comments/fields'
import { getSuggestionReviews } from '@/features/library/review-actions'
import { getReactionsFor } from '@/features/reactions/queries'
import { Reactions } from '@/features/reactions/Reactions'
import { CommentCard } from '@/features/collab/CommentCard'
import { CommentActions } from '@/features/collab/CommentActions'
import { WatchButton } from '@/features/watch/WatchButton'
import { AssigneePicker } from '@/features/issues/AssigneePicker'
import { LabelEditor } from '@/features/issues/LabelEditor'
import { MilestonePicker } from '@/features/issues/MilestonePicker'
import { getListLabels } from '@/features/issues/queries'
import { getMilestonesForPicker } from '@/features/milestones/queries'
import { getSuggestionAssignees, getSuggestionMilestone } from '@/features/library/queries'
import { setSuggestionLabels, setSuggestionMilestone, toggleSuggestionAssignee } from '@/features/library/suggestion-meta-actions'
import { getWatchCount, getWatchState } from '@/features/watch/queries'
import type { ProposedItem } from '@/shared/db'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string; id: string }> }) {
  const { handle, slug } = await params
  return { title: `Suggestion · ${handle}/${slug}` }
}

export default async function SuggestionThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string; id: string }>
  searchParams: Promise<{ e?: string; tab?: string; view?: string }>
}) {
  const [{ handle: owner, slug, id }, sp, lang, session] = await Promise.all([params, searchParams, getLang(), getSession()])
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  const sug = await getSuggestion(meta.id, id)
  if (!sug) notFound()
  const [comments, base] = await Promise.all([getSuggestionComments(sug.id), getVersionSteps(meta.id, sug.baseVersion)])
  // Канонический адрес — по номеру (человеческий), uuid остаётся рабочим входом.
  const path = `/${owner}/${slug}/suggestions/${sug.number ?? sug.id}`
  const [sugR, cmtR] = await Promise.all([
    getReactionsFor('suggestion', [sug.id], session?.userId),
    getReactionsFor('suggestion_comment', comments.map((c) => c.id), session?.userId),
  ])

  const isOwner = session?.userId === meta.ownerId
  const canMerge = isOwner || (!!session && (await isCollaborator(meta.id, session.userId)))

  // A3: branch-PR — предлагаемые шаги живут в tip ветки, а не в items;
  // diff строим против ТЕКУЩЕЙ версии main (PR = «ветка → main»).
  const snapshot = sug.branchRef ? await gitCore.branchSnapshot({ owner, slug }, sug.branchRef).catch(() => null) : null
  const branchMissing = !!sug.branchRef && !snapshot
  const items: ProposedItem[] = snapshot
    ? snapshot.steps.map((st) => ({
        title: { en: st.title },
        desc: { en: st.desc },
        command: st.command,
        hasImage: false,
        level: st.level as ProposedItem['level'],
        why: { en: st.why },
        section: { en: st.section },
        subtasks: st.subtasks.map((x) => ({ en: x })),
        refs: st.refs.map((r) => ({ label: { en: r.label }, ...(r.url ? { url: r.url } : {}) })),
      }))
    : (sug.items as ProposedItem[])
  const diffBase = sug.branchRef ? (await getVersionSteps(meta.id, meta.currentVersion))?.steps ?? [] : base?.steps ?? []

  // Ревью правки: список вердиктов + свой текущий (форма показывает выбор, а не
  // плодит копии — вердикт один на рецензента и перезаписывается).
  // Review-комментарии к пунктам правки. Состояние якоря считаем ЗДЕСЬ, против
  // предложенных пунктов: у review-комментария актуальность меняется вместе с
  // правкой, поэтому хранить её в колонках значило бы держать заведомо отстающие.
  const threads = await getSuggestionThreads(sug.id)
  const threadsByBlock = new Map<string, RowThread[]>()
  for (const th of threads) {
    const state = threadState(th.anchorOriginal, th.field, th.blockId, items as unknown as AnchorableBlock[], lang)
    const list = threadsByBlock.get(th.blockId)
    if (list) list.push({ thread: th, state })
    else threadsByBlock.set(th.blockId, [{ thread: th, state }])
  }

  const [reviews, watchState, watchCount, assignees, customLabels, msOptions, curMilestone] = await Promise.all([
    getSuggestionReviews(sug.id),
    session ? getWatchState(session.userId, meta.id) : Promise.resolve(null),
    getWatchCount(meta.id),
    getSuggestionAssignees(sug.id),
    getListLabels(meta.id),
    getMilestonesForPicker(meta.id),
    getSuggestionMilestone(sug.id),
  ])
  const myVerdict = session ? (reviews.find((r) => r.reviewer.handle === session.handle)?.verdict ?? null) : null

  // A4: для открытого branch-PR заранее считаем трёхсторонний merge — при
  // конфликте вместо кнопки Merge показываем резолвер (выбор по шагам).
  const mergeState =
    sug.branchRef && sug.status === 'open' && canMerge && !branchMissing
      ? await gitCore.mergeState({ owner, slug }, sug.branchRef).catch(() => null)
      : null
  const threeWay = mergeState ? threeWayMerge(mergeState.base, mergeState.ours, mergeState.theirs) : null
  const hasConflicts = !!threeWay && (threeWay.conflicts.length > 0 || threeWay.metaConflicts.length > 0)

  const MERGE_ERR: Record<string, { ru: string; en: string }> = {
    conflict: {
      ru: 'Конфликт: main ушёл вперёд и не сливается автоматически. Обнови ветку (влей main в неё) и попробуй снова.',
      en: 'Conflict: main has diverged and cannot be merged automatically. Update the branch (merge main into it) and retry.',
    },
    'nothing-to-merge': { ru: 'Ветка не содержит новых коммитов относительно main.', en: 'The branch has no new commits over main.' },
    unresolved: { ru: 'Разрешены не все конфликты (или ветка изменилась) — выбери версии заново.', en: 'Not all conflicts were resolved (or the branch changed) — pick again.' },
  }
  const mergeErr = sp.e ? (MERGE_ERR[sp.e] ?? { ru: 'Не удалось выполнить merge.', en: 'Merge failed.' }) : null

  // Участники для @mention: автор правки + комментаторы, без дублей.
  const sugSeen = new Set<string>()
  const sugPeople = [
    { handle: sug.author.handle, avatarUrl: sug.author.avatarUrl },
    ...comments.map((c) => ({ handle: c.authorHandle, avatarUrl: c.authorAvatarUrl })),
  ].filter((p) => p.handle && !sugSeen.has(p.handle) && sugSeen.add(p.handle))
  const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' })
  const statusLabel = sug.status === 'accepted' ? t('statusAccepted', lang) : sug.status === 'rejected' ? t('statusRejected', lang) : t('statusOpen', lang)
  // Вкладка из ?tab= — адрес ссылабелен (можно послать ссылку сразу на изменения).
  const tab: SuggestionTab = sp.tab === 'files' ? 'files' : 'conversation'
  // Вид диффа — ТОТ ЖЕ ?view=, что на сравнении версий: одно изменение выглядит
  // одинаково, откуда бы на него ни смотрели.
  const view = sp.view === 'list' ? 'list' : 'code'
  const baseCmp = rowsToCmp(diffBase as Parameters<typeof rowsToCmp>[0], lang)
  const propCmp = rowsToCmp(items as unknown as Parameters<typeof rowsToCmp>[0], lang)
  const summary = diffSteps(baseCmp, propCmp).summary
  const changedCount = summary.added + summary.removed + summary.changed + summary.moved
  const threadCount = threads.length + comments.length

  // История действий — из источников (правка, ревью, треды), а не из отдельной
  // таблицы событий: та неизбежно разошлась бы с реальным состоянием.
  const timeline: TimelineEvent[] = [
    {
      kind: 'opened' as const,
      at: new Date(sug.createdAt),
      actor: { handle: sug.author.handle, name: sug.author.name, avatarUrl: sug.author.avatarUrl },
    },
    ...reviews.map((r) => ({
      kind: (r.verdict === 'approve' ? 'review-approve' : r.verdict === 'changes' ? 'review-changes' : 'review-comment') as TimelineEvent['kind'],
      at: r.createdAt,
      actor: r.reviewer,
    })),
    ...threads.filter((th) => th.resolvedAt).map((th) => ({ kind: 'resolved' as const, at: th.resolvedAt as Date, actor: null })),
    ...(sug.resolvedAt
      ? [{ kind: (sug.status === 'accepted' ? 'merged' : 'closed') as TimelineEvent['kind'], at: new Date(sug.resolvedAt), actor: null }]
      : []),
  ].sort((a, b) => a.at.getTime() - b.at.getTime())

  const statusCls =
    sug.status === 'accepted' ? 'bg-ok text-white' : sug.status === 'rejected' ? 'bg-surface-2 text-muted' : 'bg-accent text-white'

  return (
    <>
      <div className="mx-auto w-full max-w-[1100px] px-4 py-6">
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
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold ${statusCls}`}>
            <GitPullRequest size={14} /> {statusLabel}
          </span>
          {/* Индикатор объёма правки в шапке (как +137 −9 у GitHub): видно ДО
              перехода на изменения, насколько правка велика. */}
          {(summary.added > 0 || summary.removed > 0 || summary.changed > 0) && (
            <span className="inline-flex items-center gap-2 font-mono text-[12.5px]">
              {summary.added > 0 && <span className="text-ok">+{summary.added}</span>}
              {summary.removed > 0 && <span className="text-danger">−{summary.removed}</span>}
              {summary.changed > 0 && <span className="text-warn">~{summary.changed}</span>}
            </span>
          )}
          <span className="text-[13px] text-ink-2">
            {t('proposedBy', lang)}{' '}
            <Link href={`/${sug.author.handle}`} className="font-semibold text-ink hover:text-accent">
              {sug.author.handle}
            </Link>{' '}
            · {fmt.format(new Date(sug.createdAt))} ·{' '}
            {sug.branchRef ? (
              <>
                <Link href={`/${owner}/${slug}?ref=${encodeURIComponent(sug.branchRef)}`} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-ink hover:text-accent">
                  <GitBranch size={11} /> {sug.branchRef}
                </Link>{' '}
                → <Tooltip label={t('defaultBranchHint', lang)}><span className="font-mono text-[12px]">main</span></Tooltip>
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
          filesCount={changedCount}
          labels={{ conversation: t('conversationTab', lang), files: t('proposedChanges', lang) }}
        />

        {/* Две колонки: содержимое вкладки + боковая панель (общий примитив). */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
        {sug.status !== 'open' && (
          <MergedPanel
            owner={owner}
            slug={slug}
            branch={sug.status === 'accepted' && sug.branchRef && !branchMissing && canMerge ? sug.branchRef : null}
            accepted={sug.status === 'accepted'}
            labels={{
              merged: t('prMerged', lang),
              closed: t('prClosed', lang),
              branchSafeToDelete: t('prBranchSafeDelete', lang),
              deleteBranch: t('prDeleteBranch', lang),
              branchDeleted: t('prBranchDeleted', lang),
              deleteFailed: t('prDeleteFailed', lang),
            }}
          />
        )}
        {mergeErr && (
          <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-[13px] text-danger">
            {lang === 'ru' ? mergeErr.ru : mergeErr.en}
          </div>
        )}
        {branchMissing && (
          <div className="mb-3 rounded-md border border-warn/40 bg-warn/10 px-3.5 py-2.5 text-[13px] text-warn">
            {lang === 'ru'
              ? `Ветка «${sug.branchRef}» удалена — PR неактуален, можно только отклонить.`
              : `Branch “${sug.branchRef}” was deleted — this PR is stale and can only be closed.`}
          </div>
        )}

        {sug.note && (
          <div className="mb-3 overflow-hidden rounded-lg border border-border bg-surface">
            <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-3.5 py-2 text-[12.5px] text-ink-2">
              <Avatar handle={sug.author.handle} avatarUrl={sug.author.avatarUrl} size={22} />
              <span className="font-semibold text-ink">{sug.author.handle}</span>
            </div>
            <div className="px-4 py-3">
              <Markdown refBase={`/${owner}/${slug}/issues`}>{sug.note}</Markdown>
            </div>
          </div>
        )}

        {tab === 'files' && (<>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-muted">
          {t('proposedChanges', lang)} · {lang === 'ru' ? `v${sug.baseVersion} → правка` : `v${sug.baseVersion} → suggestion`}
        </div>
        {/* Переключатель вида — общий с сравнением версий. */}
        <div className="mb-3 flex justify-end">
          <DiffViewToggle path={path} tab="files" view={view} labels={{ code: t('viewCode', lang), list: t('viewList', lang) }} />
        </div>
        {view === 'code' ? (
          <CodeDiff fromSteps={baseCmp} toSteps={propCmp} ordered={meta.ordered} lang={lang} />
        ) : (
          <ListDiff
            fromSteps={baseCmp}
            toSteps={propCmp}
            lang={lang}
            comments={{
              owner,
              slug,
              suggestionId: sug.id,
              canComment: !!session && sug.status === 'open',
              byBlock: threadsByBlock,
              labels: {
                add: t('commentAdd', lang),
                placeholder: t('commentPlaceholder', lang),
                send: t('commentSend', lang),
                cancel: t('commentCancel', lang),
                reply: t('commentReply', lang),
                resolve: t('commentResolve', lang),
                unresolve: t('commentUnresolve', lang),
                resolved: t('commentResolvedCount', lang),
                onSelection: t('commentOnSelection', lang),
                onBlock: t('commentOnBlock', lang),
                stateReanchored: t('commentReanchored', lang),
                orphanHint: t('commentOrphaned', lang),
              },
            }}
          />
        )}
        <div className="mt-2">
          <Reactions targetType="suggestion" targetId={sug.id} reactions={sugR[sug.id] ?? []} canReact={!!session} path={path} lang={lang} />
        </div>

        {/* Ревью: вердикты рецензентов + своя форма. «Нужны правки» от владельца
            или коллаборатора блокирует принятие — панель говорит об этом прямо. */}
        {sug.status === 'open' && (
          <div className="mt-3">
            <ReviewPanel
              suggestionId={sug.id}
              reviews={reviews}
              myVerdict={myVerdict}
              canReview={!!session}
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
              }}
            />
          </div>
        )}

        {isOwner && !sug.branchRef && sug.status === 'open' && meta.currentVersion > sug.baseVersion && (
          <div className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3.5 py-2.5 text-[12.5px] text-warn">
            {lang === 'ru'
              ? `Правка основана на v${sug.baseVersion}, а список уже на v${meta.currentVersion}. Принятие перезапишет более новые изменения (v${sug.baseVersion + 1}–v${meta.currentVersion}).`
              : `This suggestion is based on v${sug.baseVersion}, but the list is now at v${meta.currentVersion}. Accepting will overwrite the newer changes (v${sug.baseVersion + 1}–v${meta.currentVersion}).`}
          </div>
        )}

        {((sug.branchRef ? canMerge : isOwner) && sug.status === 'open') && (
          <div className="mt-3 flex gap-2.5">
            {sug.branchRef ? (
              !branchMissing &&
              !hasConflicts && (
                <form action={mergeBranchPr.bind(null, sug.id)}>
                  <SubmitButton className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-fg">
                    <GitMerge size={14} /> {lang === 'ru' ? 'Влить в main' : 'Merge to main'}
                  </SubmitButton>
                </form>
              )
            ) : (
            <form action={acceptSuggestion.bind(null, sug.id)}>
              <SubmitButton className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13px] font-semibold text-primary-fg">
                <Check size={14} /> {t('accept', lang)}
              </SubmitButton>
            </form>
            )}
            <form action={rejectSuggestion.bind(null, sug.id)}>
              <SubmitButton className="inline-flex items-center gap-1.5 rounded-md border border-border px-3.5 py-2 text-[13px] font-semibold text-ink hover:border-border-strong">
                <X size={14} /> {t('reject', lang)}
              </SubmitButton>
            </form>
          </div>
        )}

        {hasConflicts && threeWay && sug.branchRef && (
          <ConflictResolver
            conflicts={threeWay.conflicts}
            metaConflicts={threeWay.metaConflicts}
            branch={sug.branchRef}
            lang={lang}
            action={resolveBranchPr.bind(null, sug.id)}
          />
        )}

        </>)}

        {/* Обсуждение — вкладка по умолчанию. Заметка правки и ревью видны здесь,
            чтобы разговор шёл при полном контексте, как в Conversation у GitHub. */}
        {tab === 'conversation' && (<>
        <SuggestionTimeline
          events={timeline}
          lang={lang}
          labels={{
            opened: t('tlOpened', lang),
            approved: t('tlApproved', lang),
            requestedChanges: t('tlRequestedChanges', lang),
            commented: t('tlCommented', lang),
            resolved: t('tlResolved', lang),
            merged: t('tlMerged', lang),
            closed: t('tlClosed', lang),
          }}
        />
        <h2 className="mt-6 mb-3 text-[14px] font-bold text-ink">{t('discussionHeading', lang)}</h2>
        {comments.length === 0 ? (
          <p className="mb-3 text-[13px] text-muted">{t('noCommentsYet', lang)}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {comments.map((c) => (
              <CommentCard
                key={c.id}
                id={c.id}
                actions={
                  <CommentActions
                    commentId={c.id}
                    body={c.body}
                    path={path}
                    canEdit={session?.userId === c.authorId}
                    lang={lang}
                    labels={{
                      more: t('cmMore', lang),
                      copyLink: t('cmCopyLink', lang),
                      copyMarkdown: t('cmCopyMarkdown', lang),
                      quoteReply: t('cmQuoteReply', lang),
                      edit: t('cmEdit', lang),
                      save: t('cmSave', lang),
                      cancel: t('commentCancel', lang),
                    }}
                  />
                }
                handle={c.authorHandle}
                avatarUrl={c.authorAvatarUrl}
                date={c.createdAt}
                body={c.body}
                refBase={`/${owner}/${slug}/issues`}
                lang={lang}
                reactions={<Reactions targetType="suggestion_comment" targetId={c.id} reactions={cmtR[c.id] ?? []} canReact={!!session} path={path} lang={lang} />}
              />
            ))}
          </div>
        )}

        {session ? (
          <div className="mt-4 rounded-lg border border-border bg-surface p-4">
            <form action={addSuggestionComment} className="flex flex-col gap-3">
              <input type="hidden" name="suggestionId" value={sug.id} />
              <MarkdownEditor name="body" rows={4} placeholder={t('writeComment', lang)} maxLength={20000} lang={lang} refScope={{ owner, slug }} people={sugPeople} />
              <div className="flex justify-end">
                <SubmitButton className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13px] font-semibold text-primary-fg">
                  {t('commentBtn', lang)}
                </SubmitButton>
              </div>
            </form>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-border bg-surface px-4 py-3 text-[13.5px] text-ink-2">
            <Link href={`/login?next=${path}`} className="font-semibold text-accent hover:underline">
              {t('signInToComment', lang)}
            </Link>
          </div>
        )}
        </>)}
          </div>

          <PageAside>
            <AsideCard title={t('reviewTitle', lang)}>
              {reviews.length === 0 ? (
                <p className="text-[12.5px] text-muted">{t('reviewNobodyYet', lang)}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {reviews.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 text-[12.5px]">
                      <Avatar handle={r.reviewer.handle} avatarUrl={r.reviewer.avatarUrl} size={20} />
                      <span className="min-w-0 flex-1 truncate text-ink-2">{r.reviewer.name || r.reviewer.handle}</span>
                      <span className={r.verdict === 'approve' ? 'text-ok' : r.verdict === 'changes' ? 'text-danger' : 'text-muted'}>
                        {r.verdict === 'approve' ? t('reviewApprove', lang) : r.verdict === 'changes' ? t('reviewRequestChanges', lang) : t('reviewCommentOnly', lang)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </AsideCard>

            {session && watchState && (
              <AsideCard title={t('notifications', lang)}>
                <WatchButton
                  templateId={meta.id}
                  state={watchState}
                  count={watchCount}
                  labels={{
                    watch: t('watch', lang),
                    unwatch: t('unwatch', lang),
                    title: t('watchTitle', lang),
                    participating: t('watchParticipating', lang),
                    participatingDesc: t('watchParticipatingDesc', lang),
                    all: t('watchAll', lang),
                    allDesc: t('watchAllDesc', lang),
                    ignore: t('watchIgnore', lang),
                    ignoreDesc: t('watchIgnoreDesc', lang),
                    custom: t('watchCustom', lang),
                    customDesc: t('watchCustomDesc', lang),
                    customTitle: t('watchCustomTitle', lang),
                    evVersions: t('versionsTab', lang),
                    evIssues: t('issuesTab', lang),
                    evSuggestions: t('suggestions', lang),
                    apply: t('apply', lang),
                  }}
                />
              </AsideCard>
            )}

            <AsideCard title={t('labelsLabel', lang)}>
              <LabelEditor
                owner={owner}
                slug={slug}
                labels={(sug.labels as string[]) ?? []}
                canEdit={canMerge}
                lang={lang}
                custom={customLabels}
                onSave={setSuggestionLabels.bind(null, sug.id)}
              />
            </AsideCard>

            <AsideCard>
              <AssigneePicker
                owner={owner}
                slug={slug}
                assignees={assignees}
                canEdit={canMerge}
                lang={lang}
                onToggle={toggleSuggestionAssignee.bind(null, sug.id)}
              />
            </AsideCard>

            <AsideCard>
              <MilestonePicker
                owner={owner}
                slug={slug}
                current={curMilestone}
                options={msOptions}
                canEdit={canMerge}
                lang={lang}
                onSet={setSuggestionMilestone.bind(null, sug.id)}
              />
            </AsideCard>

            <AsideCard title={t('participants', lang)}>
              <div className="flex flex-wrap gap-1.5">
                {sugPeople.map((p) => (
                  <Link key={p.handle} href={`/${p.handle}`} title={p.handle}>
                    <Avatar handle={p.handle} avatarUrl={p.avatarUrl} size={24} />
                  </Link>
                ))}
              </div>
            </AsideCard>
          </PageAside>
        </div>
      </div>
    </>
  )
}
