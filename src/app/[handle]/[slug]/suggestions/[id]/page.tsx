import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Check, Eye, GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Pencil, RefreshCw, X } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t } from '@/shared/i18n'
import { Avatar } from '@/shared/ui/Avatar'
import { Badge, type BadgeVariant } from '@/shared/ui/badge'
import { Tooltip } from '@/shared/ui/Tooltip'
import { Markdown } from '@/shared/ui/Markdown'
import { SubmitButton } from '@/shared/ui/SubmitButton'
import { MarkdownEditor } from '@/shared/ui/MarkdownEditor'
import { getSuggestion, getSuggestionComments, getVersionSteps } from '@/features/library/queries'
import { requireViewableMeta } from '@/features/library/guard'
import { acceptSuggestion, addSuggestionComment, mergeBranchPr, rejectSuggestion, resolveBranchPr, updateBranchFromMain } from '@/features/library/actions'
import { canEditSuggestionItems } from '@/features/library/suggestion-perms'
import { ConflictResolver } from '@/features/git/ConflictResolver'
import { threeWayMerge } from '@/features/git/three-way'
import { isCollaborator } from '@/features/collab/queries'
import { gitCore } from '@/features/git/core'
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
import { suggestionChecks } from '@/features/library/suggestion-checks'
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
import { getSuggestionReviews } from '@/features/library/review-actions'
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

export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string; id: string }> }) {
  const { handle, slug } = await params
  return { title: `Suggestion · ${handle}/${slug}` }
}

export default async function SuggestionThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string; id: string }>
  searchParams: Promise<{ e?: string; tab?: string; view?: string; commit?: string }>
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
  // Правка ПУНКТОВ — не то же, что слияние: её ведут автор и исполнители, а
  // мейнтейнеры только если список это разрешил. Правило одно с экшеном.
  const canEditItems =
    !!session && sug.status === 'open' && (await canEditSuggestionItems({ ...sug, template: meta }, session.userId))

  // A3: branch-PR — предлагаемые шаги живут в tip ветки, а не в items;
  // diff строим против ТЕКУЩЕЙ версии main (PR = «ветка → main»).
  const [snapshot, mainSnapshot] = sug.branchRef
    ? await Promise.all([
        gitCore.branchSnapshot({ owner, slug }, sug.branchRef).catch(() => null),
        gitCore.branchSnapshot({ owner, slug }, 'main').catch(() => null),
      ])
    : [null, null]
  const branchMissing = !!sug.branchRef && !snapshot
  // Предлагаемые блоки — по общему правилу (тому же, что у экшена комментариев),
  // но на уже загруженном снапшоте: второй запрос к git дал бы то же самое.
  const items: ProposedItem[] = blocksFrom(sug, snapshot)
  // База диффа. У branch-PR обе стороны берём ИЗ GIT: list.json одноязычный, а
  // шаги в БД двуязычные — сравнение «ветка против БД» показывало бы двуязычный
  // список заменённым целиком (ru в базе против единственного языка в git).
  // Снапшота main нет только у репо без main — тогда честнее показать дифф
  // против версии из БД, чем ничего.
  const diffBase = sug.branchRef
    ? mainSnapshot
      ? (snapshotSteps(mainSnapshot, 'main') as unknown as ProposedItem[])
      : ((await getVersionSteps(meta.id, meta.currentVersion))?.steps ?? [])
    : (base?.steps ?? [])

  // Ревью правки: список вердиктов + свой текущий (форма показывает выбор, а не
  // плодит копии — вердикт один на рецензента и перезаписывается).
  // Review-комментарии к пунктам правки. Состояние якоря считаем ЗДЕСЬ, против
  // предложенных пунктов: у review-комментария актуальность меняется вместе с
  // правкой, поэтому хранить её в колонках значило бы держать заведомо отстающие.
  const threads = await getSuggestionThreads(sug.id, session?.userId)
  const threadsByBlock = new Map<string, RowThread[]>()
  for (const th of threads) {
    const state = threadState(th.anchorOriginal, th.field, th.blockId, items as unknown as AnchorableBlock[], lang)
    const list = threadsByBlock.get(th.blockId)
    if (list) list.push({ thread: th, state })
    else threadsByBlock.set(th.blockId, [{ thread: th, state }])
  }

  // Задачи, которые предложение закроет при слиянии («closes #12» в тексте).
  const linkedIssues = await getIssuesByNumbers(meta.id, closingRefs(sug.note))
  // Открытые задачи списка — из чего выбирать в пикере привязки.
  const canLinkIssues = !!session && sug.status === 'open' && (canMerge || session.userId === sug.authorId)
  const openIssues = canLinkIssues ? await getOpenIssuesForPicker(meta.id) : []
  // Свои неотправленные замечания — из тех же тредов (чужие сюда не попадают).
  const myPending = session
    ? threads.reduce((n, th) => n + th.comments.filter((c) => c.pending).length, 0)
    : 0
  // Нерешённые считаем из УЖЕ загруженных тредов: второй запрос дал бы то же число.
  // Условие — ровно то же, что у гейта (countUnresolvedThreads): тред из одних
  // черновиков не блокирует, иначе свой неотправленный черновик прятал бы кнопку
  // слияния от того, кто его пишет, а экшен при этом слить разрешал.
  const unresolvedThreads = threads.filter((th) => !th.resolvedAt && th.comments.some((c) => !c.pending)).length
  const [reviews, watchState, watchCount, assignees, reviewRequests, customLabels, msOptions, curMilestone] = await Promise.all([
    getSuggestionReviews(sug.id),
    session ? getWatchState(session.userId, meta.id) : Promise.resolve(null),
    getWatchCount(meta.id),
    getSuggestionAssignees(sug.id),
    getSuggestionReviewRequests(sug.id),
    getListLabels(meta.id),
    getMilestonesForPicker(meta.id),
    getSuggestionMilestone(sug.id),
  ])
  const myVerdict = session ? (reviews.find((r) => r.reviewer.handle === session.handle)?.verdict ?? null) : null

  // A4: для открытого branch-PR заранее считаем трёхсторонний merge — при
  // конфликте вместо кнопки Merge показываем резолвер (выбор по шагам).
  // Состояние merge нужно не только тому, кто сливает: по нему же видно, что ветка
  // отстала от main — а обновляет её обычно АВТОР предложения, а не мейнтейнер.
  const mergeState =
    sug.branchRef && sug.status === 'open' && (canMerge || session?.userId === sug.authorId) && !branchMissing
      ? await gitCore.mergeState({ owner, slug }, sug.branchRef).catch(() => null)
      : null
  const threeWay = mergeState ? threeWayMerge(mergeState.base, mergeState.ours, mergeState.theirs) : null
  // Ветка отстала, если merge-base ≠ tip main: в ветке нет части main. Считаем по
  // уже полученному mergeState — отдельный запрос дал бы тот же ответ.
  const branchBehind = !!mergeState && mergeState.mergeBaseSha !== mergeState.ours.tipSha
  const hasConflicts = !!threeWay && (threeWay.conflicts.length > 0 || threeWay.metaConflicts.length > 0)

  const MERGE_ERR: Record<string, { ru: string; en: string }> = {
    conflict: {
      ru: 'Конфликт: main ушёл вперёд и не сливается автоматически. Обнови ветку (влей main в неё) и попробуй снова.',
      en: 'Conflict: main has diverged and cannot be merged automatically. Update the branch (merge main into it) and retry.',
    },
    'nothing-to-merge': { ru: 'Ветка не содержит новых коммитов относительно main.', en: 'The branch has no new commits over main.' },
    'not-linear': {
      ru: 'На списке включена линейная история: сливать можно только fast-forward. Обнови ветку из main и попробуй снова.',
      en: 'This list requires linear history: only fast-forward merges are allowed. Update the branch from main and retry.',
    },
    unresolved: { ru: 'Разрешены не все конфликты (или ветка изменилась) — выбери версии заново.', en: 'Not all conflicts were resolved (or the branch changed) — pick again.' },
    // Правку не записали, потому что ветку подвинули: чужой пуш не затираем.
    stale: { ru: t('prStaleWrite', 'ru'), en: t('prStaleWrite', 'en') },
    // Применяли предложенную правку, а пункта уже нет — применять некуда.
    orphaned: {
      ru: 'Пункт, к которому относилась предложенная правка, исчез из предложения — применять некуда.',
      en: 'The item this suggestion pointed at is gone — there is nothing to apply it to.',
    },
  }
  const mergeErr = sp.e ? (MERGE_ERR[sp.e] ?? { ru: 'Не удалось выполнить merge.', en: 'Merge failed.' }) : null

  // Участники для @mention: автор правки + комментаторы, без дублей.
  const sugSeen = new Set<string>()
  const sugPeople = [
    { handle: sug.author.handle, avatarUrl: sug.author.avatarUrl },
    ...comments.map((c) => ({ handle: c.authorHandle, avatarUrl: c.authorAvatarUrl })),
  ].filter((p) => p.handle && !sugSeen.has(p.handle) && sugSeen.add(p.handle))
  const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' })
  const isDraft = sug.status === 'open' && sug.draft
  const statusLabel = isDraft
    ? t('prDraft', lang)
    : sug.status === 'accepted'
      ? t('statusAccepted', lang)
      : sug.status === 'rejected'
        ? t('statusRejected', lang)
        : t('statusOpen', lang)
  // Вкладка из ?tab= — адрес ссылабелен (можно послать ссылку сразу на изменения).
  const tab: SuggestionTab =
    sp.tab === 'files'
      ? 'files'
      : sp.tab === 'result'
        ? 'result'
        : sp.tab === 'checks'
          ? 'checks'
          : sp.tab === 'commits' && sug.branchRef
            ? 'commits'
            : 'conversation'
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

  // Проверки правки: сигналы, уже посчитанные выше, передаём аргументами —
  // считать их второй раз значило бы разойтись с тем, что показано на странице.
  // Настройки предложений — ОДИН источник и для проверок, и для причин блокировки,
  // и для экшенов (те читают их сами из списка).
  const prs = withPrDefaults(meta.prSettings)
  const approvals = reviews.filter((r) => r.verdict === 'approve').length
  const checks = await suggestionChecks({
    items: items as unknown[],
    changedCount,
    baseVersion: sug.baseVersion,
    currentVersion: meta.currentVersion,
    hasConflicts,
    branchMissing,
    draft: sug.draft,
    blockingReview: reviews.some((r) => r.blocking),
    unresolvedThreads,
    blockOnUnresolved: prs.blockOnUnresolved,
    approvals,
    requiredApprovals: prs.requiredApprovals,
    moderation: meta.moderation,
    lang: lang === 'ru' ? 'ru' : 'en',
  })
  const checksFailed = checks.filter((c) => c.status === 'fail').length

  // Личные отметки «просмотрено». Только свои: это состояние ревьюера, а не
  // свойство правки, и чужие галочки никому не показываются.
  const viewedMarks = session ? await getViewedMarks(sug.id, session.userId) : null
  // Прогресс считаем по ТЕМ ЖЕ строкам диффа, которые получают галочку, а не по
  // предложенным пунктам: у правки-удаления предложенной стороны нет вовсе, и по
  // items прогресс показывал бы ноль из нуля (или 100% без просмотра удалённого).
  const diffEntries = diffSteps(baseCmp, propCmp).entries.filter((e) => e.blockId)
  const markable = diffEntries.length
  // Устаревшая отметка просмотром НЕ считается: иначе счётчик показывал бы N/N
  // рядом с карточкой, на которой написано «просмотрено до изменения».
  const viewedCount = viewedMarks
    ? diffEntries.filter((e) => {
        const m = viewedMarks.get(String(e.blockId))
        return !!m && !isStaleMark(m, blockFingerprint(e), lang)
      }).length
    : 0

  // Коммиты ветки за вычетом main — ровно то, что уйдёт в main при слиянии.
  // У правок без ветки (старые, items в БД) коммитов нет — вкладки тоже нет.
  const commits = sug.branchRef && !branchMissing ? await gitCore.listCommits({ owner, slug }, sug.branchRef, { notIn: 'main' }) : null
  const commitAuthors = commits?.length ? await getUsersByEmails(commits.map((c) => c.authorEmail)) : {}

  // Дифф ОДНОГО коммита (?commit=sha). Стороны: сам коммит против предыдущего в
  // этой ветке; у самого раннего предыдущего нет — сравниваем с main, потому что
  // именно оттуда ветка и выросла.
  const wantSha = sp.commit && commits ? commits.findIndex((c) => c.sha === sp.commit) : -1
  const commitDiff =
    wantSha >= 0 && commits && sug.branchRef
      ? await (async () => {
          const cur = commits[wantSha]
          const prev = commits[wantSha + 1]?.sha ?? 'main'
          const [toSnap, fromSnap] = await Promise.all([
            gitCore.branchSnapshot({ owner, slug }, cur.sha).catch(() => null),
            gitCore.branchSnapshot({ owner, slug }, prev).catch(() => null),
          ])
          if (!toSnap || !fromSnap) return null
          return {
            sha: cur.sha,
            title: cur.message.split(/\r?\n/)[0] || cur.sha.slice(0, 7),
            // Обе стороны — из GIT (как и у диффа всей правки): смешивать снапшот
            // с шагами из БД нельзя, у двуязычного списка это красит всё заменой.
            from: rowsToCmp(snapshotSteps(fromSnap, 'prev') as Parameters<typeof rowsToCmp>[0], lang),
            to: rowsToCmp(snapshotSteps(toSnap, 'cur') as Parameters<typeof rowsToCmp>[0], lang),
          }
        })()
      : null

  // СОАВТОРЫ: над одной правкой работают несколько человек. У ветки это авторы
  // коммитов (git знает их и без нас), у предложений с items — те, кто правил
  // пункты. Открывшего сюда не включаем: он показан отдельно.
  const coauthorRows = await getUsersByIds(((sug.coauthorIds as string[] | null) ?? []).filter((u) => u !== sug.authorId))
  const seenCo = new Set([sug.author.handle])
  const coauthors = [
    ...coauthorRows,
    ...Object.values(commitAuthors),
  ].filter((c) => c.handle && !seenCo.has(c.handle) && seenCo.add(c.handle))

  // Состояние — общим бейджем (shared/ui/badge), а не своей плашкой: раньше
  // здесь были залитые bg-accent/bg-ok с белым текстом — они кричали громче
  // заголовка правки, ради которого человек и пришёл. Варианты бейджа тихие:
  // подложка в 15% и цветной текст, как у остальных чипов приложения.
  const statusVariant: BadgeVariant = isDraft
    ? 'soft'
    : sug.status === 'accepted'
      ? 'ok'
      : sug.status === 'rejected'
        ? 'soft'
        : 'accent'

  // Ревью нужно в ДВУХ вкладках: в обсуждении (там идёт разговор) и сразу под
  // изменениями (отревьюил — тут же вынес вердикт). Один элемент, а не две копии
  // одной формы: вкладки взаимоисключающие, так что в дерево попадёт ровно одна.
  // Почему нельзя слить. Раньше блокирующее ревью просто заставляло экшен молча
  // вернуться: пользователь жал кнопку и не получал ничего. Теперь причина названа,
  // а кнопки нет — состояние видно до клика.
  // Причины считаем ПО ТЕМ ЖЕ настройкам, что и экшены. Иначе настройка «не
  // блокировать при нерешённых обсуждениях» выключалась бы только наполовину
  // (экшен пропускает, а кнопки нет), а «требовать N одобрений» — наоборот: кнопка
  // есть, экшен молча отказывает. Оба перекоса уже были на этой странице.
  const blockReasons: string[] = []
  if (reviews.some((r) => r.blocking)) blockReasons.push(t('prBlockedReview', lang))
  if (prs.blockOnUnresolved && unresolvedThreads > 0) blockReasons.push(`${t('prBlockedThreads', lang)}: ${unresolvedThreads}`)
  if (prs.requiredApprovals > approvals)
    blockReasons.push(`${t('prBlockedApprovals', lang)}: ${approvals}/${prs.requiredApprovals}`)

  const reviewPanel =
    sug.status === 'open' ? (
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
    ) : null

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
          {/* Крупнее рядового чипа (это главный статус страницы), но той же
              тихой палитры. */}
          <Badge variant={statusVariant} className="px-3 py-1 text-[12.5px]">
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
          <span className="text-[13px] text-ink-2">
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
                    {coauthors.length > 3 && <span className="font-mono text-[11px] text-muted">+{coauthors.length - 3}</span>}
                  </span>
                </Tooltip>
              </>
            )}{' '}
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
              ? `Ветка «${sug.branchRef}» удалена — предложение неактуально, можно только отклонить.`
              : `Branch “${sug.branchRef}” was deleted — this PR is stale and can only be closed.`}
          </div>
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
                className="inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-semibold text-ink hover:border-border-strong"
              >
                <ArrowLeft size={14} /> <span className="max-sm:hidden">{t('prAllCommits', lang)}</span>
              </Link>
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{commitDiff.title}</span>
              <span className="shrink-0 font-mono text-[12px] text-muted">{commitDiff.sha.slice(0, 7)}</span>
              <div className="ml-auto max-sm:w-full max-sm:justify-end">
                <DiffViewToggle
                  path={`${path}?tab=commits&commit=${commitDiff.sha}`}
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
          <ChecksList items={checks} labels={{ blocking: t('checksBlocking', lang), allGood: t('checksAllGood', lang) }} />
        )}

        {tab === 'files' && (<>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-muted">
          {t('proposedChanges', lang)} · {lang === 'ru' ? `v${sug.baseVersion} → предложение` : `v${sug.baseVersion} → suggestion`}
        </div>
        {/* Ряд действий над диффом: слева прогресс ревью, справа правка и
            переключатель вида — одной высоты (эталон настроек). */}
        <div className="mb-3 flex items-center justify-end gap-2">
          {/* Прогресс — только своему ревьюеру и только когда есть что отмечать.
              На мобиле остаются цифры, слово прячется: оно предсказуемо. */}
          {viewedMarks && sug.status === 'open' && markable > 0 && (
            <span className="mr-auto inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
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
              className="inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-semibold text-ink hover:border-border-strong"
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
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-muted">
              {t('resultTab', lang)} · {lang === 'ru' ? `станет v${meta.currentVersion + 1}` : `becomes v${meta.currentVersion + 1}`}
            </div>
            <SuggestionResult items={items} lang={lang} ordered={meta.ordered} />
          </>
        )}

        {/* Обсуждение — вкладка по умолчанию. Заметка правки и ревью видны здесь,
            чтобы разговор шёл при полном контексте, как в Conversation у GitHub. */}
        {tab === 'conversation' && (<>
        {/* Заметка правки — первое сообщение обсуждения (как тело PR у GitHub), а
            не шапка на всех вкладках: в «Проверках» и «Изменениях» она мешала. */}
        {sug.note && (
          <div className="mb-3 overflow-hidden rounded-lg border border-border bg-surface">
            <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-3.5 py-2 text-[12.5px] text-ink-2">
              <Avatar handle={sug.author.handle} avatarUrl={sug.author.avatarUrl} size={22} />
              <span className="font-semibold text-ink">{sug.author.handle}</span>
            </div>
            <div className="px-4 py-3">
              <Markdown refBase={`/${owner}/${slug}/issues`}>{sug.note}</Markdown>
              <div className="mt-2">
                <Reactions targetType="suggestion" targetId={sug.id} reactions={sugR[sug.id] ?? []} canReact={!!session} path={path} lang={lang} />
              </div>
            </div>
          </div>
        )}

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

        {/* Блок слияния — там же, где обсуждение: решение принимают, прочитав
            разговор. Предупреждение про устаревшую базу и резолвер конфликтов
            стоят рядом с кнопкой, а не на вкладке изменений. */}
        {isOwner && !sug.branchRef && sug.status === 'open' && meta.currentVersion > sug.baseVersion && (
          <div className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3.5 py-2.5 text-[12.5px] text-warn">
            {lang === 'ru'
              ? `Предложение основано на v${sug.baseVersion}, а список уже на v${meta.currentVersion}. Принятие перезапишет более новые изменения (v${sug.baseVersion + 1}–v${meta.currentVersion}).`
              : `This suggestion is based on v${sug.baseVersion}, but the list is now at v${meta.currentVersion}. Accepting will overwrite the newer changes (v${sug.baseVersion + 1}–v${meta.currentVersion}).`}
          </div>
        )}

        {/* Черновик: слияния нет, вместо него — отметка готовности (автор или мейнтейнер). */}
        {isDraft && (session?.userId === sug.authorId || canMerge) && (
          <DraftToggle
            draft
            action={setSuggestionDraft.bind(null, sug.id)}
            labels={{ ready: t('prReadyForReview', lang), back: t('prBackToDraft', lang), hint: t('prDraftHint', lang) }}
          />
        )}

        {/* Ветка отстала от main — обратное слияние одной кнопкой. Показываем и при
            конфликте: как раз тогда обновление чаще всего и решает дело. */}
        {branchBehind && sug.status === 'open' && !branchMissing && (
          <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-md border border-border bg-surface-2 px-3.5 py-2.5">
            <span className="text-[12.5px] text-ink-2">{t('prBranchBehind', lang)}</span>
            <form action={updateBranchFromMain.bind(null, sug.id)} className="ml-auto">
              <SubmitButton className="inline-flex h-[38px] items-center gap-1.5 rounded-md border border-border px-3.5 text-[13px] font-semibold text-ink hover:border-border-strong">
                <RefreshCw size={14} /> {t('prUpdateBranch', lang)}
              </SubmitButton>
            </form>
          </div>
        )}

        {blockReasons.length > 0 && sug.status === 'open' && !isDraft && (
          <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-[12.5px] text-danger">
            {t('prMergeBlocked', lang)}: {blockReasons.join('; ')}
          </div>
        )}

        {((sug.branchRef ? canMerge : isOwner) && sug.status === 'open' && !isDraft) && (
          <div className="mt-3 flex gap-2.5">
            {/* Кнопка слияния прячется при блокировке, «Отклонить» — нет: отклонить
                предложение можно в любом состоянии, это не обход гейта. */}
            {blockReasons.length > 0 ? null : sug.branchRef ? (
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

        {!isDraft && sug.status === 'open' && (session?.userId === sug.authorId || canMerge) && (
          <DraftToggle
            draft={false}
            action={setSuggestionDraft.bind(null, sug.id)}
            labels={{ ready: t('prReadyForReview', lang), back: t('prBackToDraft', lang), hint: t('prDraftHint', lang) }}
          />
        )}

        {/* Резолвер — только тому, кто может сливать: его экшен всё равно требует
            прав, а показывать автору форму, которая ничего не сделает, — обман. */}
        {hasConflicts && threeWay && sug.branchRef && canMerge && (
          <ConflictResolver
            conflicts={threeWay.conflicts}
            metaConflicts={threeWay.metaConflicts}
            branch={sug.branchRef}
            lang={lang}
            action={resolveBranchPr.bind(null, sug.id)}
          />
        )}

        {reviewPanel}

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

            {/* Запрошенные рецензенты — ТОТ ЖЕ пикер, что исполнители: набор людей
                с поиском по handle. Разница только в подписях и в действии. */}
            <AsideCard>
              <AssigneePicker
                owner={owner}
                slug={slug}
                assignees={reviewRequests}
                canEdit={canMerge || session?.userId === sug.authorId}
                lang={lang}
                onToggle={toggleReviewRequest.bind(null, sug.id)}
                labels={{
                  title: t('prReviewers', lang),
                  add: t('prRequestReview', lang),
                  empty: t('prReviewersEmpty', lang),
                  remove: t('prCancelRequest', lang),
                }}
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

            {/* Development у GitHub: какие задачи закроет слияние. Привязка живёт
                строкой `closes #N` в тексте — пикер её дописывает, поэтому набранное
                руками и выбранное мышью это одно и то же. */}
            {(linkedIssues.length > 0 || (canLinkIssues && openIssues.length > 0)) && (
              <AsideCard title={t('prLinkedIssues', lang)}>
                {linkedIssues.length > 0 && (
                  <ul className="mb-1.5 flex flex-col gap-1.5">
                    {linkedIssues.map((iss) => (
                      <li key={iss.number} className="flex items-start gap-1.5 text-[12.5px]">
                        <Link href={`/${owner}/${slug}/issues/${iss.number}`} className="font-mono text-muted hover:text-accent">
                          #{iss.number}
                        </Link>
                        <span className={`min-w-0 flex-1 ${iss.status === 'closed' ? 'text-muted line-through' : 'text-ink-2'}`}>{iss.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <LinkIssuePicker
                  suggestionId={sug.id}
                  issues={openIssues}
                  linked={closingRefs(sug.note)}
                  canEdit={canLinkIssues}
                  labels={{
                    add: t('prLinkIssue', lang),
                    empty: t('prLinkIssueEmpty', lang),
                    filter: t('prLinkIssueFilter', lang),
                    remove: t('prLinkIssueRemove', lang),
                    hint: t('prLinkedIssuesHint', lang),
                  }}
                />
              </AsideCard>
            )}

            {/* Замок обсуждения — служебное и редкое, поэтому в самом низу панели,
                а не рядом с частыми действиями. */}
            {canMerge && (
              <AsideCard>
                <LockToggle
                  suggestionId={sug.id}
                  locked={!!sug.lockedAt}
                  labels={{ lock: t('prLock', lang), unlock: t('prUnlock', lang), hint: t('prLockHint', lang) }}
                />
              </AsideCard>
            )}

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
