import 'server-only'
import { notFound } from 'next/navigation'
import type { BadgeVariant } from '@/shared/ui/badge'
import { t, type Lang, type TKey } from '@/shared/i18n'
import type { ProposedItem } from '@/shared/db'
import { isAdminHandle } from '@/shared/auth/admin'
import { getIssuesByNumbers, getSuggestion, getSuggestionAssignees, getSuggestionCommentsPage, getSuggestionParticipants, getSuggestionMilestone, getSuggestionReviewRequests, getUsersByEmails, getUsersByIds, getVersionSteps, getViewedMarks } from '@/features/library/queries'
import { requireViewableMeta } from '@/features/library/guard'
import { canEditSuggestionItems } from '@/features/library/suggestion-perms'
import { threeWayMerge } from '@/features/git/three-way'
import { isCollaborator } from '@/features/collab/queries'
import { gitCore } from '@/features/git/core'
import { snapshotSteps } from '@/features/git/snapshot-steps'
import { diffSteps, rowsToCmp } from '@/features/library/diff'
import type { SuggestionTab } from '@/features/library/SuggestionTabs'
import { reportedChecks, suggestionChecks } from '@/features/library/suggestion-checks'
import { withPrDefaults } from '@/features/library/pr-settings'
import { blocksFrom } from '@/features/library/suggestion-blocks'
import { blockFingerprint, isStaleMark } from '@/features/library/viewed-fingerprint'
import { closingRefs } from '@/features/library/closing-refs'
import type { TimelineEvent } from '@/features/library/SuggestionTimeline'
import { getSuggestionThreads } from '@/features/comments/queries'
import { AFTER_PARAM, BEFORE_PARAM, COMMENTS_PER_PAGE, cursorHref, readCursor } from '@/shared/lib/paging'
import { threadState } from '@/features/comments/state'
import type { RowThread } from '@/features/library/DiffComments'
import type { AnchorableBlock } from '@/features/comments/fields'
import { getSuggestionReviews } from '@/features/library/review-queries'
import { getReactionsFor } from '@/features/reactions/queries'
import { getListLabels, getOpenIssuesForPicker } from '@/features/issues/queries'
import { getMilestonesForPicker } from '@/features/milestones/queries'
import { getWatchCount, getWatchState } from '@/features/watch/queries'

// Почему merge не прошёл — по коду из ?e=. Тексты в словаре: это то, что человек
// читает, а не техническая метка.
const MERGE_ERR: Record<string, TKey> = {
  conflict: 'prMergeErrConflict',
  'nothing-to-merge': 'prMergeErrNothing',
  'not-linear': 'prMergeErrNotLinear',
  unresolved: 'prMergeErrUnresolved',
  // Правку не записали, потому что ветку подвинули: чужой пуш не затираем.
  stale: 'prStaleWrite',
  // Применяли предложенную правку, а пункта уже нет — применять некуда.
  orphaned: 'prMergeErrOrphaned',
  // Хранилище списка разошлось с базой: слияние ждёт починки, а не повтора.
  'out-of-sync': 'prMergeErrOutOfSync',
  // Спросить о праве на запись не удалось. Два случая, и советы противоположные:
  // связь сорвалась — повторить; ответ не разобран — повтор бесполезен. Без этих
  // строк оба падали в общий `prMergeErrGeneric` («не удалось»), то есть человек
  // не узнавал ни причины, ни того, ждать ему или нет.
  'gate-unavailable': 'branch.errGateUnavailable',
  'gate-malformed': 'branch.errGateMalformed',
}

/**
 * Всё, что странице предложения нужно знать, прежде чем что-то показать: доступ,
 * снимки веток, дифф, обсуждения, ревью, состояние слияния, проверки, коммиты.
 *
 * Отдельно от разметки, потому что это две разные работы. Здесь — правила: чей дифф
 * против чего строится, кто вправе сливать, что считается нерешённым обсуждением,
 * почему кнопки слияния нет. Там — как это выглядит. Пока они жили одной функцией,
 * страница на тысячу строк открывалась и ради подписи кнопки, и ради правила ревью.
 *
 * Возвращаем ровно то, что читает разметка: промежуточные величины (полный список
 * тредов, состояние merge, счётчик одобрений) остаются внутри.
 */
export async function loadSuggestionPage({
  owner,
  slug,
  id,
  sp,
  lang,
  session,
}: {
  owner: string
  slug: string
  id: string
  sp: { e?: string; tab?: string; view?: string; commit?: string; after?: string; before?: string }
  lang: Lang
  session: { userId: string; handle: string } | null
}) {
  const meta = await requireViewableMeta(owner, slug)
  if (!meta) notFound()
  const sug = await getSuggestion(meta.id, id)
  if (!sug) notFound()
  // Тред листается ключом; мусорный курсор — «показать сначала», а не пятисотка.
  const { cursor, dir } = readCursor(sp)
  const [thread, participants, base] = await Promise.all([
    getSuggestionCommentsPage(sug.id, COMMENTS_PER_PAGE, cursor, dir),
    // Участники — по всему треду, а не по показанной порции.
    getSuggestionParticipants(sug.id),
    getVersionSteps(meta.id, sug.baseVersion),
  ])
  const comments = thread.items
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
    const state = threadState(th.anchorOriginal, th.field, th.blockId, items as unknown as AnchorableBlock[], lang, th.contextSnapshot, th.contextLang)
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
    getSuggestionReviews(sug.id, session?.userId, isAdminHandle(session?.handle)),
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

  const mergeErr = sp.e ? (MERGE_ERR[sp.e] ?? 'prMergeErrGeneric') : null

  // Участники для @mention: автор правки + комментаторы, без дублей.
  const sugSeen = new Set<string>()
  const sugPeople = [
    { handle: sug.author.handle, avatarUrl: sug.author.avatarUrl },
    ...participants,
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
  const view: 'list' | 'code' = sp.view === 'list' ? 'list' : 'code'
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
  // Внешние проверки (агент/CI через MCP) идут ПОСЛЕ своих: сначала то, что
  // приложение знает само, потом то, что прислали снаружи.
  const [ownChecks, extChecks] = await Promise.all([
    suggestionChecks({
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
    }),
    reportedChecks(sug.id),
  ])
  const checks = [...ownChecks, ...extChecks]
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
  // этой ветке. У самого раннего предыдущего нет — сравниваем с ТОЧКОЙ ВЕТВЛЕНИЯ
  // (merge-base), а не с нынешним main: main мог уйти вперёд после создания ветки,
  // и тогда его более поздние правки читались бы как изменения этого коммита. Точки
  // ветвления нет (репозиторий без main) — тогда честнее main, чем ничего.
  const wantSha = sp.commit && commits ? commits.findIndex((c) => c.sha === sp.commit) : -1
  const commitDiff =
    wantSha >= 0 && commits && sug.branchRef
      ? await (async () => {
          const cur = commits[wantSha]
          const prev = commits[wantSha + 1]?.sha ?? mergeState?.mergeBaseSha ?? 'main'
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
  // Внешние проверки — по тем же данным, что на вкладке проверок: причина блокировки
  // и сама проверка не должны расходиться.
  if (prs.blockOnFailedChecks) {
    const held = extChecks.filter((c) => c.status === 'fail' || c.status === 'pending')
    if (held.length > 0) blockReasons.push(`${t('prBlockedChecks', lang)}: ${held.map((c) => c.title).join(', ')}`)
  }
  if (prs.requiredApprovals > approvals)
    blockReasons.push(`${t('prBlockedApprovals', lang)}: ${approvals}/${prs.requiredApprovals}`)

  return {
    comments,
    // Шаги треда — готовыми адресами: разметка не должна знать ни про курсоры, ни про
    // имена параметров.
    threadSteps: {
      prev: thread.prev ? cursorHref(path, sp, BEFORE_PARAM)(thread.prev) : null,
      next: thread.next ? cursorHref(path, sp, AFTER_PARAM)(thread.next) : null,
    },
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
  }
}
