// БЕЗ loading.tsx намеренно. Скелетон на этом сегменте включает потоковую отдачу:
// шапка ответа уходит клиенту сразу, и notFound() ниже уже не может поставить 404 —
// прод отдавал страницу «не найдено» с кодом 200, а поисковик считал её живой.
// Замер после снятия скелетона: первый байт 0,3 с — ждать нечего.
import { Fragment, type ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink, Eye, FileText, UserRound, GitBranch, GitCommitHorizontal, GitFork, GitPullRequest, History, Info, LayoutTemplate, Lock, Paperclip, PlayCircle, Rocket, Sparkles, Star, Tag, SquareCheckBig } from 'lucide-react'
import { CloneDropdown } from '@/features/git/CloneDropdown'
import { startRun } from '@/features/runs/actions'
import { openBranchPr, revertToVersion, useTemplate } from '@/features/library/actions'
import { Button } from '@/shared/ui/button'
import { gitCore } from '@/features/git/core'
import { snapshotSteps } from '@/features/git/snapshot-steps'
import { BranchPicker } from '@/features/git/BranchPicker'
import { branchLabel } from '@/features/git/branch-label'
import { isCollaborator } from '@/features/collab/queries'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr, type LocaleText } from '@/shared/i18n'
import { detectTextLang } from '@/shared/i18n/detect-text-lang'
import { UserLine } from '@/shared/ui/UserLine'
import { Tooltip } from '@/shared/ui/Tooltip'
import { SectionLabel } from '@/shared/ui/SectionLabel'
import { AsideCard, PageAside } from '@/shared/ui/PageAside'
import { DismissibleHint } from '@/shared/ui/DismissibleHint'
import { CopyButton } from '@/shared/ui/CopyButton'
import { SmartImage } from '@/shared/ui/SmartImage'
import { Markdown } from '@/shared/ui/Markdown'
import { DigChatHost, DigChatOpen } from '@/features/dig/DigChat'
import { digStepsWithSession } from '@/features/dig/queries'
import { getRoster } from '@/shared/ai/roster'
import { StepDangerBadge, StepLevelBadge } from '@/shared/ui/StepLevelBadge'
import { timeAgo } from '@/shared/ui/timeAgo'
import { getContributors, getStepPreviews, getVersionAuthors, getVersionSteps, getDraft } from '@/features/library/queries'
import { CommitBar } from '@/features/library/CommitBar'
import { ListStats } from '@/features/library/ListStats'
import { getWatchCount } from '@/features/watch/queries'
import { getListLineage, isLineageExact } from '@/features/library/lineage'
import { ListLineage } from '@/features/library/ListLineage'
import { getPollResults } from '@/features/polls/queries'
import { PollBlock, type PollContent } from '@/features/polls/PollBlock'
import { VideoEmbed } from '@/features/library/VideoEmbed'
import { QuizBlock } from '@/features/quizzes/QuizBlock'
import { hasAffiliateLink, hasMarkedAffiliate, markedAdvertisers, quizKind, stripQuizAnswers, type QuizBlockContent } from '@/core'
import { getMonetizationSettings } from '@/shared/settings/monetization'
import { getCourseCompletion, getQuizState } from '@/features/quizzes/queries'
import { quizContentHash } from '@/core/domain/quiz-fingerprint'
import { CourseProgress } from '@/features/quizzes/CourseProgress'
import { CourseOutline, type OutlineLesson } from '@/features/library/CourseOutline'
import { blockChatTitle, pollDeadlineMs, productItems } from '@/features/library/blocks'
import { ProductBlock } from '@/shared/ui/ProductBlock'
import { requireViewableDetail, requireViewableMeta } from '@/features/library/guard'
import { db, listLinks, templates as templatesTable, users as usersTable, publiclyVisible } from '@/shared/db'
import { and as andOp, eq } from 'drizzle-orm'
import { SafeLink } from '@/shared/ui/SafeLink'
import { renderWikiLinks } from '@/shared/lib/wiki-links'
import { linkLabel } from '@/shared/lib/link-label'
import { ViewBeacon } from '@/features/analytics/ViewBeacon'
import { ListActionsMenu } from '@/features/library/ListActionsMenu'
import { ReportButton } from '@/features/reports/ReportButton'
import { publishList } from '@/features/library/actions'
import { CONTROL_H, CONTROL_TEXT, PAGE, STACK } from '@/shared/ui/control'

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + 'k'
  return String(n)
}


// Заголовок вкладки как в GitHub: owner/slug (layout добавит « · SetFork»).
export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  // Вкладка браузера = человеческий title, а не slug (title гейтит requireViewableMeta).
  const [meta, lang] = await Promise.all([requireViewableMeta(handle, slug), getLang()])
  return { title: meta ? tr(meta.title, lang) : `${handle}/${slug}` }
}

import { loadListPage, sectionAnchor } from './load'

export default async function ListPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ find?: string; ref?: string; v?: string }>
}) {
  const [{ handle: owner, slug }, sp, lang] = await Promise.all([params, searchParams, getLang()])
  const loaded = await loadListPage({ owner, slug, sp, lang })
  const {
    gatedFromLesson,
    detail,
    tpl,
    currentVersion,
    steps,
    branches,
    refBranch,
    refCommit,
    snapshot,
    branchInfo,
    curNum,
    histNum,
    histVer,
    allSteps,
    readOnlyView,
    find,
    viewer,
    canInteract,
    isOwner,
    digSteps,
    canManageBranches,
    myDraft,
    stepImages,
    isStepBlock,
    blockImages,
    pollResults,
    quizBids,
    quizStates,
    completion,
    digGnomes,
    backlinks,
    lessons,
    lessonOfBlock,
    firstLockedIdx,
    nowMs,
    displayNum,
    contributors,
    watchers,
    versionAuthors,
    commitsCount,
    lineage,
    lineageExact,
    lineageNames,
    base,
    mon,
    showDisclosure,
    showAdMarking,
    adAdvertisers,
    latestNote,
    titleIsForeign,
  } = loaded

  return (
    <>
      {/* Просмотр: владелец себя не накручивает, сервер дополнительно дедупит. */}
      {!isOwner && mon.viewTracking && <ViewBeacon templateId={tpl.id} />}
      {viewer && !readOnlyView && <DigChatHost gnomes={digGnomes} lang={lang} />}
      <div className="print:hidden">
      </div>

      <div className={PAGE}>
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Основное: содержимое-эталон */}
          {/* Единый вертикальный ритм колонки: интервал задаёт контейнер, а не
              каждая полоса своим mb-* (см. STACK). */}
          <main className={`min-w-0 flex-1 ${STACK}`}>
            {/* Заголовок только для печати (в экране он в шапке) */}
            <div className="hidden print:block">
              <h1 className="text-[1.25rem] font-bold text-ink">{tr(tpl.title, lang)}</h1>
              {tr(tpl.desc, lang) && <p className="mt-1 text-[0.8125rem] text-ink-2">{tr(tpl.desc, lang)}</p>}
              <p className="mt-1 font-mono text-[0.6875rem] text-muted">
                {owner}/{slug} · v{currentVersion?.version ?? tpl.currentVersion}
              </p>
            </div>

            {/* About на мобиле — НАВЕРХУ (как GitHub): описание, теги, статы со словами.
                На десктопе всё это в About-сайдбаре справа. */}
            <div className="lg:hidden print:hidden">
              {/* Описание и теги пишет человек, длину тега никто не режет — без переноса
                  один тег или «слово» в описании уносит страницу за край (мобила 390px). */}
              {tr(tpl.desc, lang) && <p className="text-[0.8125rem] leading-snug text-ink-2 [overflow-wrap:anywhere]">{tr(tpl.desc, lang)}</p>}
              {tpl.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tpl.tags.map((tg) => (
                    <Link key={tg} href={`/search?q=${encodeURIComponent(`tag:${tg}`)}`} className="min-w-0 rounded-full bg-(--accent-soft) px-2.5 py-0.5 text-[0.78125rem] text-accent [overflow-wrap:anywhere]">
                      {tg}
                    </Link>
                  ))}
                </div>
              )}
              {/* Сводка показателей — как строка под описанием репозитория у GitHub.
                  Тот же компонент стоит в About-сайдбаре на десктопе. */}
              <div className="mt-3">
                <ListStats
                  base={base}
                  lang={lang}
                  stars={tpl.starsCount}
                  forks={tpl.forksCount}
                  watchers={watchers}
                  runs={tpl.runsCount}
                  branches={Math.max(1, branches.length)}
                  version={currentVersion?.version ?? tpl.currentVersion}
                  visibility={tpl.visibility}
                />
              </div>
            </div>

            {/* Неопубликованные правки видит только тот, кто их писал: черновик у
                каждого автора свой, и чужой черновик — не его дело. Без этой метки
                про накопленные правки легко забыть — список выглядит как обычно. */}
            {myDraft && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3 print:hidden">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-ink">
                    <FileText size={15} className="text-muted" /> {t('draftEditsPending', lang)}
                  </div>
                  <p className="mt-0.5 text-[0.78125rem] text-ink-2">
                    {t('draftEditsPendingHint', lang).replace('{when}', timeAgo(myDraft.updatedAt, lang))}
                  </p>
                </div>
                {/* Ссылка-кнопка тем же размером, что кнопки рядом: высоты берём из
                    шкалы контролов, а не подбираем на глаз. */}
                <Link
                  href={`${base}/edit`}
                  className={`inline-flex ${CONTROL_H.md} items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 ${CONTROL_TEXT.md} font-semibold text-ink hover:border-border-strong`}
                >
                  {t('openDraft', lang)}
                </Link>
              </div>
            )}

            {tpl.status === 'draft' && isOwner && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warn bg-surface px-4 py-3 print:hidden">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-warn">
                    <FileText size={15} /> {t('draftBadge', lang)}
                  </div>
                  <p className="mt-0.5 text-[0.78125rem] text-ink-2">{t('draftHint', lang)}</p>
                </div>
                <form action={publishList.bind(null, tpl.id)}>
                  <Button type="submit" variant="primary" size="md">
                    <Rocket size={14} /> {t('publish', lang)}
                  </Button>
                </form>
              </div>
            )}
            {tpl.origin === 'ai_draft' && tpl.status === 'published' && (
              <DismissibleHint
                storageKey={`hint:ai-draft:${tpl.id}`}
                className="rounded-lg border border-(--accent) bg-(--accent-soft) px-4 py-3 text-[0.8125rem] text-accent print:hidden"
              >
                <Sparkles size={15} className="shrink-0" /> {t('aiVerifyHint', lang)}
              </DismissibleHint>
            )}
            {/* РФ-маркировка «Реклама» — до ссылок; компактная пометка (сам erid
                едет в ссылке через /api/go). ч. 16 ст. 18.1 требует назвать
                рекламодателя — добавляем наименование+ИНН из правил.
                self-start: во flex-колонке элемент иначе растянулся бы на всю
                ширину, а пометка должна быть по содержимому. */}
            {showAdMarking && (
              <div className="inline-flex flex-wrap items-center gap-x-1.5 self-start rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[0.6875rem] font-medium text-ink-2">
                <span>{mon.adMarkingText}</span>
                {adAdvertisers.length > 0 && (
                  <span className="font-normal text-muted">
                    · {t('adAdvertiser', lang)}:{' '}
                    {adAdvertisers
                      .map((a) => (a.advertiserInn ? `${a.advertiser}, ${t('innLabel', lang)} ${a.advertiserInn}` : a.advertiser))
                      .join('; ')}
                  </span>
                )}
              </div>
            )}
            {/* FTC-дисклеймер: показывается ДО ссылок (требование к affiliate-раскрытию). */}
            {showDisclosure && (
              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-4 py-3 text-[0.78125rem] text-ink-2">
                <Info size={15} className="shrink-0 text-muted" /> {mon.disclosureText}
              </div>
            )}

            {/* Панель над списком (как у GitHub над файлами). Мобильная логика
                (фидбек владельца): ДВЕ плотные строки — (1) инфо: ветка · аватар ·
                ник · vN · ⚒ · время; (2) действия ВПРАВО: Run · Получить · ✎.
                Всё лишнее для узкого экрана (note, счётчики, blame) — только sm+.
                На sm+ прежний вид: инфо слева, действия справа. */}
            {currentVersion && (
              <>
                {/* УПРАВЛЕНИЕ — вне рамки, отдельной строкой над коробкой коммита: ровно
                    как у GitHub, где «main ▾» и «Code» стоят НАД коробкой последнего
                    коммита, а не внутри неё. Рамка вокруг кнопок читалась как лишний
                    контейнер: она ничего не группировала, кроме самой себя. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.78125rem] text-ink-2 print:hidden">
                  {/* Пикер веток показываем ВСЕГДА, когда ветка есть (как GitHub «main ▾» —
                      даже одна ветка и на чужом списке; canManage лишь гейтит создание). */}
                  {branches.length > 0 && (
                    <BranchPicker base={base} owner={owner} slug={slug} branches={branches} current={refBranch ?? 'main'} lang={lang} canManage={canManageBranches} />
                  )}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {tpl.isTemplate && viewer && (
                    <form action={useTemplate.bind(null, tpl.id)} className="inline-flex">
                      <Tooltip label={lang === 'ru' ? 'Создать свой список из этого шаблона' : 'Start your own list from this template'}>
                        <button
                          type="submit"
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[0.8125rem] font-semibold text-ink hover:border-border-strong"
                        >
                          <LayoutTemplate size={14} /> <span className="hidden md:inline">{lang === 'ru' ? 'Использовать шаблон' : 'Use this template'}</span>
                        </button>
                      </Tooltip>
                    </form>
                  )}
                  <CloneDropdown base={base} lang={lang} />
                  {/* Вторичное (правка/перевод/история/blame) — одним «...»-меню,
                      а не россыпью разновысоких иконок (эталон: секции настроек). */}
                  <ListActionsMenu
                    base={base}
                    isOwner={isOwner}
                    templateId={tpl.id}
                    lang={lang}
                    canTranslate={canManageBranches && !readOnlyView && titleIsForeign}
                    targetLang={lang}
                  />
                  {/* Run — первичное действие (прогон): к ПРАВОМУ КРАЮ ряда (thumb-зона, по
                      mobile-ui: primary справа-внизу). Кнопка-иконка 36×36, подпись в тултипе/aria. */}
                  {/* На альтернативном снимке (ветка/прошлая версия) прогон не предлагаем:
                      он всё равно стартовал бы на ТЕКУЩЕЙ версии — обманчиво. */}
                  {viewer && !readOnlyView && (
                    <form action={startRun.bind(null, tpl.id)} className="inline-flex">
                      <Tooltip label={t('runStart', lang)}>
                        <button type="submit" aria-label={t('runStart', lang)} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-fg hover:opacity-90">
                          <PlayCircle size={16} />
                        </button>
                      </Tooltip>
                    </form>
                  )}
                </div>
                </div>

                <CommitBar
                  authors={versionAuthors}
                  message={latestNote || t('noCommitMessage', lang)}
                  version={currentVersion.version}
                  createdAt={currentVersion.createdAt}
                  commitsCount={commitsCount}
                  versionsHref={`${base}/versions`}
                  lang={lang}
                  labels={{
                    history: t('versionsTab', lang),
                    expand: t('list.showFullMessage', lang),
                    collapse: t('list.hideMessage', lang),
                    commitLink: t('list.thisCommitHistory', lang),
                    and: t('list.and', lang),
                    others: t('list.andNOthers', lang),
                  }}
                />
              </>
            )}

            {/* Просмотр «на коммите»: снимок списка, каким он был тогда. Отдельная
                плашка, а не ветковая: у коммита нет ahead/behind, и предлагать
                «открыть pull request» с исторического снимка бессмысленно. */}
            {refCommit && snapshot && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[0.78125rem] text-ink print:hidden">
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
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-[0.78125rem] text-ink print:hidden">
                <GitCommitHorizontal size={13} className="shrink-0 text-warn" />
                <span>
                  {lang === 'ru' ? 'Ветка' : 'Branch'} <b className="font-mono">{branchLabel(refBranch, lang)}</b> · +{branchInfo.ahead}/-{branchInfo.behind}{' '}
                  {lang === 'ru' ? 'относительно main (черновик, версии не создаются)' : 'vs main (draft — no versions projected)'}
                </span>
                <span className="ml-auto flex items-center gap-3">
                  {viewer && branchInfo.ahead > 0 && (
                    <form action={openBranchPr.bind(null, tpl.id, refBranch)}>
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 font-semibold text-ink hover:border-border-strong"
                      >
                        <GitPullRequest size={12} /> {lang === 'ru' ? 'Открыть pull request' : 'Open pull request'}
                      </button>
                    </form>
                  )}
                  <Link href={base} className="font-semibold text-accent hover:underline">
                    {lang === 'ru' ? '← на main' : '← back to main'}
                  </Link>
                </span>
              </div>
            )}

            {/* Просмотр прошлой версии (?v=N): снимок только для чтения + возврат. */}
            {histVer && histNum && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-accent/50 bg-accent/10 px-3 py-2 text-[0.78125rem] text-ink print:hidden">
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
                    <Button variant="outline">
                      {t('list.toV', lang).replace('{v}', String(curNum))}
                    </Button>
                  </Link>
                </span>
              </div>
            )}
            {/* Результат поиска внутри списка (?find=). */}
            {find && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-(--accent)/50 bg-(--accent-soft) px-3 py-2 text-[0.78125rem] text-ink print:hidden">
                <Info size={13} className="shrink-0 text-accent" />
                <span>
                  <b>{steps.length}</b> / {allSteps.length} {lang === 'ru' ? 'шагов по запросу' : 'steps match'}{' '}
                  <span className="font-mono">“{sp.find}”</span>
                </span>
                <Link href={base} className="ml-auto font-semibold text-accent hover:underline">
                  {lang === 'ru' ? 'Показать все' : 'Show all'}
                </Link>
              </div>
            )}
            {viewer && (quizBids.length > 0 || completion) && (
              <CourseProgress passed={quizBids.filter((b) => quizStates[b]?.correct).length} total={quizBids.length} lang={lang} certificateHref={`${base}/certificate`} leaderboardHref={`${base}/leaderboard`} completed={completion} />
            )}
            <div className="flex flex-col gap-3">
              {steps.map((s, si) => {
                // Заголовок урока/секции — у ЛЮБОГО блока: показываем, когда секция
                // отличается от секции ПРЕДЫДУЩЕГО блока (начинается новый урок).
                const section = tr(s.section, lang)
                const prevSection = si > 0 ? tr(steps[si - 1].section, lang) : ''
                const showHeader = !!section && section !== prevSection
                const header = showHeader ? (
                  <h2 id={sectionAnchor(section)} className={`scroll-mt-24 text-[0.8125rem] font-semibold uppercase tracking-[0.06em] text-ink-2 [overflow-wrap:anywhere] ${si > 0 ? 'mt-3' : ''}`}>
                    {section}
                  </h2>
                ) : null

                // Quiz-gate: блоки заблокированного урока не показываем; на первом —
                // карточка-замок «пройдите тесты предыдущего урока».
                if (firstLockedIdx >= 0 && lessonOfBlock[si] >= gatedFromLesson) {
                  if (si !== firstLockedIdx) return null
                  const prevLesson = lessons[gatedFromLesson - 1]
                  return (
                    <div key={s.id} className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-surface-2 px-4 py-5 text-[0.8125rem] text-ink-2">
                      <Lock size={18} className="shrink-0 text-muted" />
                      <span>
                        {lang === 'ru' ? 'Дальше откроется, когда сдадите тесты урока' : 'Unlocks once you pass the tests of'}{' '}
                        <b className="text-ink">«{prevLesson?.title}»</b>
                        {prevLesson ? ` (${prevLesson.quizPassed}/${prevLesson.quizTotal})` : ''}.
                      </span>
                    </div>
                  )
                }

                // Презентационные блоки (text/image/video/poll/quiz) — вне карточки-шага.
                if (!isStepBlock(s)) {
                  let el: ReactNode = null
                  if (s.type === 'text') {
                    const md = typeof s.content?.md === 'string' ? s.content.md : ''
                    // Текст-блок — такая же карточка с киркой, как шаг: это часть материала,
                    // по которой так же копают (в прохождении он уже такой — RunView). Раньше
                    // здесь был голый абзац: ни рамки, ни входа в чат (фидбек владельца).
                    const canDig = !!viewer && !readOnlyView && typeof s.n === 'number'
                    el = md ? (
                      <div className="relative break-inside-avoid rounded-lg border border-border bg-surface p-4">
                        {viewer && !readOnlyView && typeof s.n === 'number' && (
                          <span className="absolute right-2 top-2 print:hidden">
                            <DigChatOpen
                              detail={{ templateId: tpl.id, stepN: s.n, stepTitle: blockChatTitle('text', '', section, lang) }}
                              label={t('list.digIntoStep', lang)}
                              hasSession={digSteps.has(s.n)}
                            />
                          </span>
                        )}
                        <Markdown className={`text-[0.875rem] leading-relaxed text-ink-2${canDig ? ' pr-10' : ''}`}>{renderWikiLinks(md)}</Markdown>
                      </div>
                    ) : null
                  } else if (s.type === 'image') {
                    const ref = typeof s.content?.ref === 'string' ? s.content.ref : ''
                    const url = ref ? blockImages[ref] : ''
                    const caption = typeof s.content?.caption === 'string' ? s.content.caption : ''
                    el = url ? (
                      <figure className="break-inside-avoid">
                        <SmartImage src={url} alt={caption || t('screenshot', lang)} className="max-h-[32.5rem] w-auto rounded-lg border border-border" />
                        {caption && <figcaption className="mt-1.5 text-[0.78125rem] text-muted">{caption}</figcaption>}
                      </figure>
                    ) : null
                  } else if (s.type === 'video') {
                    const url = typeof s.content?.url === 'string' ? s.content.url : ''
                    const cap = typeof s.content?.caption === 'string' ? s.content.caption : ''
                    el = url ? <div><VideoEmbed url={url} caption={cap} /></div> : null
                  } else if (s.type === 'file') {
                    const url = typeof s.content?.url === 'string' ? s.content.url : ''
                    const name = typeof s.content?.name === 'string' ? s.content.name : ''
                    el = url ? (
                      <SafeLink href={url} className="inline-flex max-w-full items-center gap-2 break-inside-avoid rounded-md border border-border bg-surface-2 px-3 py-2 text-[0.8125rem] text-accent hover:border-border-strong">
                        <Paperclip size={15} className="shrink-0 text-muted" />
                        <span className="min-w-0 truncate">{name || url}</span>
                      </SafeLink>
                    ) : null
                  } else if (s.type === 'product') {
                    // href — через /api/go/<step>/p<idx> (клики+партнёрский тег), если
                    // трекинг включён; у snapshot-веток нет DB-id → прямой url.
                    const items = productItems(s.content).map((p) => ({
                      ...p,
                      href: !readOnlyView && mon.linkTracking ? `/api/go/${s.id}/p${p.idx}` : p.url,
                    }))
                    const title = typeof s.content?.title === 'string' ? s.content.title : ''
                    el = items.length ? <ProductBlock title={title} items={items} lang={lang} /> : null
                  } else if (s.type === 'poll') {
                    const c = (s.content ?? {}) as unknown as PollContent & { bid?: string }
                    const bid = typeof c.bid === 'string' ? c.bid : ''
                    el = Array.isArray(c.options) && c.options.length ? (
                      <div className="break-inside-avoid">
                        <PollBlock
                          templateId={tpl.id}
                          bid={bid}
                          content={c}
                          result={pollResults[bid] ?? { counts: {}, voters: 0, myVotes: [] }}
                          canVote={canInteract}
                          closed={(() => { const dm = pollDeadlineMs(c.deadline); return dm !== null && dm < nowMs })()}
                          lang={lang}
                        />
                      </div>
                    ) : null
                  } else if (s.type === 'quiz') {
                    const c = (s.content ?? {}) as unknown as QuizBlockContent
                    const bid = typeof c.bid === 'string' ? c.bid : ''
                    const kind = quizKind(c)
                    const renderable =
                      kind === 'choice'
                        ? Array.isArray(c.options) && c.options.length > 0
                        : kind === 'blank'
                          ? typeof c.template === 'string' && c.template.includes('___')
                          : kind === 'match'
                            ? (Array.isArray(c.pairs) && c.pairs.length > 0) || (Array.isArray(c.lefts) && c.lefts.length > 0)
                            : kind === 'sort'
                              ? (Array.isArray(c.items) && c.items.length > 0) || (Array.isArray(c.shuffled) && c.shuffled.length > 0)
                              : true
                    // Авторизованному оценивает сервер → НЕ отдаём ответы в разметку.
                    const safe: QuizBlockContent = viewer ? stripQuizAnswers(c) : c
                    el = renderable ? (
                      <div className="break-inside-avoid">
                        <QuizBlock
                          content={safe}
                          lang={lang}
                          templateId={tpl.id}
                          bid={bid}
                          canSubmit={canInteract}
                          // Режим разметки — по тому, вырезаны ли ответы, а не по праву
                          // отвечать: иначе на снимке авторизованный зритель попадал в
                          // анонимный режим, которому нужны ответы (их уже нет).
                          answersStripped={!!viewer}
                          initial={quizStates[bid] ?? { selected: [], correct: false, attempts: 0, submitted: false }}
                        />
                      </div>
                    ) : null
                  }
                  if (!el && !header) return null
                  return (
                    <Fragment key={s.id}>
                      {header}
                      {el}
                    </Fragment>
                  )
                }
                const subs = (s.subtasks as LocaleText[]).map((x) => tr(x, lang)).filter(Boolean)
                // href — через /api/go (журнал кликов), если трекинг включён в админке;
                // у веток snapshot-шаги без DB-id → прямой url. Экспорт/MD не трогаем.
                const refs = (s.refs as { label: LocaleText; url?: string }[]).map((x, ri) => ({
                  label: tr(x.label, lang),
                  url: x.url,
                  href: x.url && !readOnlyView && mon.linkTracking ? `/api/go/${s.id}/${ri}` : x.url,
                }))
                return (
                  <Fragment key={s.id}>
                    {header}
                  <div className="relative break-inside-avoid rounded-lg border border-border bg-surface p-4">
                    {/* Кирка — СТРОГО в правом верхнем углу карточки (absolute, не в потоке:
                        при переносе заголовка она уплывала в середину — фидбек владельца). */}
                    {viewer && !readOnlyView && typeof s.n === 'number' && (
                      <span className="absolute right-2 top-2 print:hidden">
                        <DigChatOpen detail={{ templateId: tpl.id, stepN: s.n, stepTitle: tr(s.title, lang) }} label={t('list.digIntoStep', lang)} hasSession={digSteps.has(s.n)} />
                      </span>
                    )}
                    <div className="flex gap-3">
                      <span className="mt-0.5 font-mono text-[0.8125rem] text-muted">{tpl.ordered ? displayNum[si] : '•'}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 pr-7">
                          {/* Заголовок шага пишет человек: слово без пробелов иначе уезжает
                              за правый край и тянет за собой страницу (мобила 390px). */}
                          <span className="min-w-0 text-[0.875rem] font-semibold text-ink [overflow-wrap:anywhere]">{tr(s.title, lang)}</span>
                          <StepLevelBadge level={s.level} lang={lang} />
                          {/* Разрушительный пункт виден ДО того, как его скопировали
                              в терминал, — на сайте, а не только в скрипте. */}
                          <StepDangerBadge step={s} lang={lang} />
                        </div>
                        {tr(s.desc, lang) && <Markdown className="mt-1">{renderWikiLinks(tr(s.desc, lang))}</Markdown>}
                        {tr(s.why, lang) && (
                          <div className="mt-1.5 flex gap-1.5 text-[0.78125rem] text-ink-2">
                            <Info size={13} className="mt-0.5 shrink-0 text-muted" />
                            <span className="min-w-0 [overflow-wrap:anywhere]">
                              <span className="font-medium text-ink-2">{t('whyLabel', lang)}:</span> {tr(s.why, lang)}
                            </span>
                          </div>
                        )}
                        {/* «ЗДЕСЬ НУЖЕН ЧЕЛОВЕК»: место, где машина честно не знает —
                            местные цены, вкус, время на вашем оборудовании. Не дефект, а
                            приглашение: реальный опыт доступен человеку, не модели.
                            Приглашение ведёт в тот же поток правки, что и кнопка сверху. */}
                        {s.needsHuman && (
                          <div className="mt-1.5 flex gap-1.5 rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-2 text-[0.78125rem] text-ink-2">
                            <UserRound size={13} className="mt-0.5 shrink-0 text-muted" />
                            <span className="min-w-0 [overflow-wrap:anywhere]">
                              <span className="font-medium text-ink-2">{t('needsHumanLabel', lang)}:</span>{' '}
                              {tr(s.needsHumanAsk, lang) || t('needsHumanGeneric', lang)}
                              {!readOnlyView && (
                                <>
                                  {' '}
                                  <Link href={isOwner ? `${base}/edit` : `${base}/suggest`} className="underline decoration-dotted hover:text-ink">
                                    {t('needsHumanAnswer', lang)}
                                  </Link>
                                </>
                              )}
                            </span>
                          </div>
                        )}
                        {stepImages[s.id] && (
                          <SmartImage
                            src={stepImages[s.id]}
                            alt={t('screenshot', lang)}
                            className="mt-3 max-h-[26.25rem] w-auto rounded-lg border border-border"
                          />
                        )}
                        {s.command && (
                          <div className="mt-3 flex items-center gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 font-mono text-[0.78125rem] text-ink">
                            <span className="shrink-0" style={{ color: 'var(--accent)' }}>$</span>
                            {/* Горизонтальный скролл + выделение: можно доскроллить до конца строки
                                и выделить/скопировать её часть, а не только всю через кнопку. */}
                            <span className="no-scrollbar min-w-0 flex-1 select-text overflow-x-auto whitespace-nowrap">{s.command}</span>
                            <CopyButton text={s.command} lang={lang} />
                          </div>
                        )}
                        {subs.length > 0 && (
                          <div className="mt-3">
                            {/* subtasks — критерии проверки шага (см. промпт генерации:
                                «verification checks»), а не под-шаги: подписываем и рисуем
                                чек-квадратами, иначе выглядят оторванным списком. */}
                            <div className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">
                              {t('stepChecksLabel', lang)}
                            </div>
                            <ul className="flex flex-col gap-1.5">
                              {/* Ключ по тексту проверки, а не по индексу: при правке шага
                                  список пересобирается, и индексные ключи путают строки. */}
                              {subs.map((label, i) => (
                                <li key={`${label}#${i}`} className="flex gap-2 text-[0.8125rem] text-ink-2 [overflow-wrap:anywhere]">
                                  <SquareCheckBig size={14} className="mt-0.5 shrink-0 text-muted" />
                                  {label}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {refs.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {refs.map((r) => {
                              // Подпись ссылки нередко и есть URL — без переноса чип уносит страницу.
                              const cls =
                                'inline-flex min-w-0 items-center gap-1 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[0.6875rem] text-accent [overflow-wrap:anywhere]'
                              // Подписи может не быть (ссылку кладут одним url) — показываем домен.
                              const text = linkLabel(r.label, r.url)
                              return r.url ? (
                                <SafeLink key={`${r.label}:${r.url}`} href={r.href ?? r.url} rel="nofollow noreferrer" className={cls}>
                                  <ExternalLink size={11} /> {text}
                                </SafeLink>
                              ) : (
                                <span key={`${r.label}:`} className={cls}>
                                  <ExternalLink size={11} /> {text}
                                </span>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  </Fragment>
                )
              })}
            </div>
          </main>

          {/* About-сайдбар */}
          <PageAside>
            <CourseOutline lessons={lessons} showProgress={!!viewer} lang={lang} />
            {backlinks.length > 0 && (
              <AsideCard title={t('list.linkedFrom', lang)}>
                <ul className="flex flex-col gap-1.5">
                  {backlinks.map((b) => (
                    <li key={`${b.handle}/${b.slug}`}>
                      <Link href={`/${b.handle}/${b.slug}`} className="block truncate text-[0.8125rem] text-accent hover:underline">
                        {tr(b.title as LocaleText, lang) || `${b.handle}/${b.slug}`}
                      </Link>
                    </li>
                  ))}
                </ul>
              </AsideCard>
            )}
            {/* На УЗКОМ экране сайдбар уезжает под содержимое, и «О списке» повторяло то,
                что уже прочитано наверху: описание и теги стоят под заголовком списка.
                Дубль внизу — это лишний экран прокрутки ни за чем. Поэтому на мобиле от
                карточки остаются только КОНТРИБЬЮТОРЫ, а описание, теги и сам заголовок
                карточки показываются с lg, где сайдбар — отдельная колонка. */}
            {/* Секции сайдбара — БЕЗ рамки и подложки, разделены волосяной линией (как «About /
                Releases / Contributors» у GitHub). Карточка-контейнер тут ничего не
                группировала: на десктопе она обводила и без того отдельную колонку, а на
                мобиле, где внутри остаются одни контрибьюторы, давала пустую рамку с
                отступами — то самое «странное пустое место». */}
            <div className="flex flex-col gap-4">
              <SectionLabel className="hidden lg:flex">
                {t('about', lang)}
              </SectionLabel>
              {tr(tpl.desc, lang) && <p className="hidden text-[0.8125rem] leading-relaxed text-ink-2 lg:block">{tr(tpl.desc, lang)}</p>}
              {tpl.tags.length > 0 && (
                <div className="hidden flex-wrap gap-1.5 lg:flex">
                  {tpl.tags.map((tag) => (
                    <Link
                      key={tag}
                      href={`/search?q=${encodeURIComponent(`tag:${tag}`)}`}
                      className="rounded-full bg-(--accent-soft) px-2.5 py-0.5 text-[0.78125rem] font-medium text-accent hover:underline"
                    >
                      {tag}
                    </Link>
                  ))}
                </div>
              )}
              {/* Тот же состав показателей, что в сводке на мобиле — колонкой. На узком
                  экране сайдбар уезжает ПОД содержимое, и показатели вышли бы дважды:
                  там показывает сводка наверху, здесь — только с lg. */}
              <div className="hidden flex-col gap-2 border-t border-border pt-4 text-[0.8125rem] text-ink-2 lg:flex">
                <div>
                <ListStats
                  base={base}
                  lang={lang}
                  layout="column"
                  stars={tpl.starsCount}
                  forks={tpl.forksCount}
                  watchers={watchers}
                  runs={tpl.runsCount}
                  branches={Math.max(1, branches.length)}
                  version={currentVersion?.version ?? tpl.currentVersion}
                  visibility={tpl.visibility}
                />
                </div>
              </div>

              {/* Родословная — тоже только с lg: на узком экране это большой блок (исходный
                  запрос, участники витка, отвергнутые варианты), и он ровно так же
                  превращал карточку из «только контрибьюторы» в экран прокрутки. */}
              {lineage && (
                <div className="hidden lg:block">
                  <ListLineage lineage={lineage} exact={lineageExact} gnomeNames={lineageNames} lang={lang} />
                </div>
              )}

              {contributors.length > 0 && (
                <div className="border-t border-border pt-4">
                  {/* Как у GitHub: счётчик бейджем в заголовке, ниже — строки «ник имя».
                      Сеткой аватаров было не разобрать, кто есть кто. */}
                  <SectionLabel className="mb-2 flex items-center gap-1.5">
                    {t('contributors', lang)}
                    <span className="rounded-full bg-surface-2 px-1.5 text-[0.6875rem] font-semibold text-ink-2">{contributors.length}</span>
                  </SectionLabel>
                  <div className="flex flex-col gap-1">
                    {contributors.slice(0, 8).map((c) => (
                      <UserLine
                        key={c.handle}
                        handle={c.handle}
                        name={c.name ?? undefined}
                        avatarUrl={c.avatarUrl}
                        size="md"
                        className="min-w-0 py-0.5"
                      />
                    ))}
                    {/* Их может быть много: остальные — в зачёте вкладов, а не простыней в сайдбаре. */}
                    {contributors.length > 8 && (
                      <Link href={`${base}/leaderboard`} className="mt-0.5 text-[0.78125rem] font-semibold text-accent hover:underline">
                        {`+${contributors.length - 8}`}
                      </Link>
                    )}
                  </div>
                </div>
              )}

              {/* Жалоба — последней строкой карточки: на узком экране от неё остаются
                  только контрибьюторы, и начинать блок кнопкой «пожаловаться» странно. */}
              {!isOwner && (
                <div className="border-t border-border pt-4 text-[0.8125rem] text-ink-2">
                  <ReportButton templateId={tpl.id} lang={lang} />
                </div>
              )}
            </div>
          </PageAside>
        </div>
      </div>
    </>
  )
}
