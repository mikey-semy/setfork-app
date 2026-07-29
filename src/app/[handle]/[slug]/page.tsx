// БЕЗ loading.tsx намеренно. Скелетон на этом сегменте включает потоковую отдачу:
// шапка ответа уходит клиенту сразу, и notFound() ниже уже не может поставить 404 —
// прод отдавал страницу «не найдено» с кодом 200, а поисковик считал её живой.
// Замер после снятия скелетона: первый байт 0,3 с — ждать нечего.
import { Fragment, type ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink, Eye, FileText, UserRound, GitBranch, GitCommitHorizontal, GitFork, GitPullRequest, History, Info, LayoutTemplate, Lock, Paperclip, PlayCircle, Rocket, Sparkles, Star, Tag, Users , SquareCheckBig } from 'lucide-react'
import { CloneDropdown } from '@/features/git/CloneDropdown'
import { startRun } from '@/features/runs/actions'
import { openBranchPr, revertToVersion, useTemplate } from '@/features/library/actions'
import { Button } from '@/shared/ui/button'
import { gitCore } from '@/features/git/core'
import { snapshotSteps } from '@/features/git/snapshot-steps'
import { BranchPicker } from '@/features/git/BranchPicker'
import { isCollaborator } from '@/features/collab/queries'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr, type LocaleText } from '@/shared/i18n'
import { detectTextLang } from '@/shared/i18n/detect-text-lang'
import { Avatar } from '@/shared/ui/Avatar'
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
import { StepLevelBadge } from '@/shared/ui/StepLevelBadge'
import { timeAgo } from '@/shared/ui/timeAgo'
import { getContributors, getStepPreviews, getVersionSteps } from '@/features/library/queries'
import { getListLineage, isLineageExact } from '@/features/library/lineage'
import { ListLineage } from '@/features/library/ListLineage'
import { getPollResults } from '@/features/polls/queries'
import { PollBlock, type PollContent } from '@/features/polls/PollBlock'
import { VideoEmbed } from '@/features/library/VideoEmbed'
import { QuizBlock } from '@/features/quizzes/QuizBlock'
import { hasAffiliateLink, hasMarkedAffiliate, markedAdvertisers, quizKind, stripQuizAnswers, type QuizBlockContent } from '@/core'
import { getMonetizationSettings } from '@/shared/settings/monetization'
import { getCourseCompletion, getQuizState } from '@/features/quizzes/queries'
import { CourseProgress } from '@/features/quizzes/CourseProgress'
import { CourseOutline, type OutlineLesson } from '@/features/library/CourseOutline'
import { pollDeadlineMs, productItems } from '@/features/library/blocks'
import { ProductBlock } from '@/shared/ui/ProductBlock'
import { requireViewableDetail, requireViewableMeta } from '@/features/library/guard'
import { db, listLinks, templates as templatesTable, users as usersTable, publiclyVisible } from '@/shared/db'
import { and as andOp, eq } from 'drizzle-orm'
import { SafeLink } from '@/shared/ui/SafeLink'
import { renderWikiLinks } from '@/shared/lib/wiki-links'
import { ViewBeacon } from '@/features/analytics/ViewBeacon'
import { ListActionsMenu } from '@/features/library/ListActionsMenu'
import { ReportButton } from '@/features/reports/ReportButton'
import { publishList } from '@/features/library/actions'

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + 'k'
  return String(n)
}

// Стабильный anchor-id для заголовка урока/секции (для оглавления курса).
function sectionAnchor(s: string): string {
  return 'lesson-' + s.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

// Заголовок вкладки как в GitHub: owner/slug (layout добавит « · SetFork»).
export async function generateMetadata({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params
  // Вкладка браузера = человеческий title, а не slug (title гейтит requireViewableMeta).
  const [meta, lang] = await Promise.all([requireViewableMeta(handle, slug), getLang()])
  return { title: meta ? tr(meta.title, lang) : `${handle}/${slug}` }
}

export default async function ListPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; slug: string }>
  searchParams: Promise<{ find?: string; ref?: string; v?: string }>
}) {
  const [{ handle: owner, slug }, sp, lang] = await Promise.all([params, searchParams, getLang()])
  const detail = await requireViewableDetail(owner, slug)
  if (!detail) notFound()
  const { tpl, currentVersion, steps: dbSteps } = detail

  // Ветки (A1 read-only): селектор + просмотр снапшота ветки по ?ref=.
  const branches = await gitCore.listBranches({ owner, slug }).catch(() => [])
  const refBranch = sp.ref && sp.ref !== 'main' && branches.some((b) => b.name === sp.ref) ? sp.ref : null
  // ?ref= принимает и КОММИТ — «открыть список таким, каким он был на этом
  // коммите» (аналог /tree/<sha> у GitHub). Отдельной страницы это не требует:
  // просмотр «на рефе» уже умеет рендерить снапшот, коммит — такой же реф.
  // Строгая проверка формы sha: реф уходит в git-команду, и чужие строки здесь
  // не нужны (сам снапшот вернёт null, если такого объекта в репо нет).
  const refCommit = !refBranch && sp.ref && /^[0-9a-f]{7,40}$/i.test(sp.ref) ? sp.ref : null
  const snapshot = refBranch || refCommit ? await gitCore.branchSnapshot({ owner, slug }, (refBranch ?? refCommit)!) : null
  const branchInfo = refBranch ? branches.find((b) => b.name === refBranch) : null

  // Просмотр ПРОШЛОЙ версии по ?v=N (снимок из template_versions, только чтение).
  // Каждая версия хранит полный набор блоков — рендерим их тем же кодом, что и
  // текущую, поэтому старую версию видно целиком, а не только как дифф.
  const askedV = Number(sp.v)
  const curNum = currentVersion?.version ?? tpl.currentVersion
  const histNum = Number.isInteger(askedV) && askedV > 0 && askedV !== curNum ? askedV : null
  const histVer = histNum && !refBranch && !refCommit ? await getVersionSteps(tpl.id, histNum) : null
  // На ветке рендерим её шаги (маппинг plain→LocaleText-шейп; картинок у снапшота нет).
  const allSteps = snapshot
    ? (snapshotSteps(snapshot) as unknown as typeof dbSteps)
    : (histVer?.steps ?? dbSteps)

  // Любой альтернативный снимок (ветка или прошлая версия) — только чтение:
  // раскопки/трекинг ссылок/перевод привязаны к ТЕКУЩЕЙ версии.
  const readOnlyView = !!snapshot || !!histVer


  // Поиск ВНУТРИ списка (?find= из поиска в шапке): фильтр шагов по подстроке —
  // аналог поиска по файлам в GitHub-репо, для больших списков.
  const find = (sp.find ?? '').trim().toLowerCase()
  const matches = (s: (typeof allSteps)[number]) =>
    Object.values(s.title).some((v) => v?.toLowerCase().includes(find)) ||
    Object.values(s.desc ?? {}).some((v) => v?.toLowerCase().includes(find)) ||
    (s.command ?? '').toLowerCase().includes(find)
  const steps = find ? allSteps.filter(matches) : allSteps
  const viewer = await getSession()
  const say = (en: string, rus: string) => (lang === 'ru' ? rus : en) // строки-аргументами (i18n-lint)
  const isOwner = viewer?.userId === tpl.ownerId
  // Точка на кирке: у каких пунктов есть сохранённая dig-сессия зрителя (resilient — [] без таблицы).
  const digSteps = viewer && !readOnlyView ? await digStepsWithSession(tpl.id, viewer.userId) : new Set<number>()
  // Ветками управляют те, кто может пушить: владелец или коллаборатор.
  const canManageBranches = isOwner || (!!viewer && (await isCollaborator(tpl.id, viewer.userId)))
  // Резолвим скриншоты шагов (storage_key → подписанный imgproxy-URL), ключ = id шага.
  const previews = await getStepPreviews(steps, 'rs:fit:1400:1400')
  const stepImages: Record<string, string> = Object.fromEntries(
    steps.filter((s) => s.imageKey && previews[s.imageKey]).map((s) => [s.id, previews[s.imageKey as string]]),
  )
  // Картинки image-блоков (storage_key в content.ref) резолвим так же, как скриншоты шагов.
  const isStepBlock = (s: (typeof steps)[number]) => !s.type || s.type === 'step'
  const imageRefs = steps
    .filter((s) => s.type === 'image' && typeof s.content?.ref === 'string' && s.content.ref)
    .map((s) => (s.content as { ref: string }).ref)
  const blockImages = imageRefs.length ? await getStepPreviews(imageRefs.map((ref) => ({ imageKey: ref })), 'rs:fit:1400:1400') : {}
  // Результаты poll-блоков (голоса вне git — по стабильному content.bid).
  const pollBids = steps.filter((s) => s.type === 'poll' && typeof s.content?.bid === 'string').map((s) => (s.content as { bid: string }).bid)
  const pollResults = pollBids.length ? await getPollResults(tpl.id, pollBids, viewer?.userId) : {}
  // Состояние quiz-блоков (последняя попытка зрителя — по content.bid).
  const quizBids = steps.filter((s) => s.type === 'quiz' && typeof s.content?.bid === 'string').map((s) => (s.content as { bid: string }).bid)
  const quizStates = quizBids.length ? await getQuizState(tpl.id, quizBids, viewer?.userId) : {}
  // Прохождение курса — ПОСТОЯННЫЙ факт: плашка с сертификатом видна и после
  // правок тестов автором (иначе вернувшемуся «проходи заново ради бумажки»).
  const completion = viewer ? await getCourseCompletion(tpl.id, viewer.userId) : null
  // Шахты «Копать глубже» (HQ §8): выкопанные слои текущей версии — по шагам.
  // У snapshot-веток раскопки нет (шаги без стабильных номеров версии).
  // Мини-чат раскопки (редизайн HQ §8): ростер для выбора собеседника в чате.
  const digGnomes = viewer && !readOnlyView
    ? (await getRoster()).map((e) => ({ id: e.id, name: lang === 'ru' ? e.nameRu : e.nameEn, guild: lang === 'ru' ? e.guildRu : e.guildEn }))
    : []
  // Backlinks (HQ §11, Obsidian-вектор): публичные списки, ссылающиеся на этот
  // через [[handle/slug]] (list_links пересобирает реиндекс).
  const backlinks = await db
    .select({ slug: templatesTable.slug, title: templatesTable.title, handle: usersTable.handle })
    .from(listLinks)
    .innerJoin(templatesTable, eq(listLinks.fromId, templatesTable.id))
    .innerJoin(usersTable, eq(usersTable.id, templatesTable.ownerId))
    .where(
      andOp(
        eq(listLinks.toId, tpl.id),
        publiclyVisible(),
      ),
    )
    .limit(10)
  // Уроки курса = секции блоков (в порядке). Собираем оглавление + прогресс тестов по уроку.
  // lessonOfBlock[si] = индекс урока блока si (−1 = до первого урока).
  const lessons: OutlineLesson[] = []
  const lessonOfBlock: number[] = []
  {
    let cur: OutlineLesson | null = null
    for (const s of steps) {
      const sec = tr(s.section, lang)
      if (sec && (!cur || cur.title !== sec)) {
        cur = { title: sec, anchor: sectionAnchor(sec), quizTotal: 0, quizPassed: 0 }
        lessons.push(cur)
      }
      lessonOfBlock.push(cur ? lessons.length - 1 : -1)
      if (s.type === 'quiz' && cur) {
        const bid = typeof s.content?.bid === 'string' ? s.content.bid : ''
        cur.quizTotal++
        if (quizStates[bid]?.correct) cur.quizPassed++
      }
    }
  }
  // Quiz-gate: последовательный доступ. Первый урок с несданными тестами гейтит —
  // всё, что ПОСЛЕ него, заблокировано. Только для ученика (не владельца, не анона).
  const isOwnerViewer = !!viewer && viewer.userId === tpl.ownerId
  let gatedFromLesson = -1
  if (tpl.gated && viewer && !isOwnerViewer) {
    const g = lessons.findIndex((l) => l.quizTotal > 0 && l.quizPassed < l.quizTotal)
    if (g >= 0) gatedFromLesson = g + 1
  }
  const firstLockedIdx = gatedFromLesson >= 0 ? steps.findIndex((_, si) => lessonOfBlock[si] >= gatedFromLesson) : -1
  // eslint-disable-next-line react-hooks/purity -- серверный компонент, one-shot рендер: время для дедлайнов опросов
  const nowMs = Date.now()
  // Порядковый номер показываем только по шаг-блокам (презентационные вне нумерации).
  let stepSeq = 0
  const displayNum = steps.map((s) => (isStepBlock(s) ? ++stepSeq : 0))
  const contributors = await getContributors(tpl.id, tpl.ownerId)
  // Родословная: как список появился (запрос, участники витка, прецеденты, разбор критика,
  // где не было опоры) и какие варианты не выбрали. Ничего не рисуется у списков, сделанных
  // руками — там объяснять нечего.
  // РОДОСЛОВНАЯ — ТОЛЬКО ХОЗЯЕВАМ СПИСКА. В ней лежит содержимое личной сессии
  // генерации: исходный запрос владельца, отвергнутые варианты и разбор критика.
  // Раньше условие смотрело лишь на readOnlyView, поэтому у опубликованного
  // ИИ-черновика всё это доставалось анониму: публикация списка молча публиковала и
  // черновой диалог, которого автор не показывал. Те же данные через getGeneration
  // всегда требовали совпадения владельца — здесь правило теперь такое же.
  const [lineage, lineageExact] =
    readOnlyView || !canManageBranches ? [null, false] : await Promise.all([getListLineage(tpl.id), isLineageExact(tpl.id)])
  // Имена специалистов для родословной: id вроде 'coder' человеку ничего не говорят.
  // Ростер тянем только если родословная есть — на рукотворных списках лишнего запроса нет.
  const lineageNames = lineage ? Object.fromEntries((await getRoster()).map((e) => [e.id, lang === 'ru' ? e.nameRu : e.nameEn])) : undefined
  const base = `/${owner}/${slug}`
  // Монетизация/трафик (админка): тумблеры трекинга + FTC-плашка, если среди
  // ссылок списка (всех, не только отфильтрованных ?find=) есть партнёрские.
  const mon = await getMonetizationSettings()
  const affiliateUrls = allSteps.flatMap((s) => [
    ...(s.refs as { url?: string }[]).map((r) => r.url),
    ...(s.type === 'product' ? productItems(s.content).map((p) => p.url) : []),
  ])
  const showDisclosure = mon.affiliateEnabled && mon.disclosureEnabled && hasAffiliateLink(affiliateUrls, mon.affiliateRules)
  // РФ-маркировка (ФЗ «О рекламе»): пометка «Реклама» на списках, где есть
  // ссылка с настроенным erid. Управляется отдельным тумблером в админке.
  const showAdMarking = mon.affiliateEnabled && mon.adMarkingEnabled && hasMarkedAffiliate(affiliateUrls, mon.affiliateRules)
  // ч. 16 ст. 18.1: пометка обязана называть рекламодателя (наименование+ИНН).
  const adAdvertisers = showAdMarking ? markedAdvertisers(affiliateUrls, mon.affiliateRules) : []
  // Показываем note версии, только если он осмысленный (не служебный boilerplate).
  const rawNote =
    currentVersion?.note && !['initial', 'edit', 'seeded', 'ai draft'].includes(currentVersion.note)
      ? currentVersion.note
      : ''
  // Служебные note от MCP/API хранятся по-английски — локализуем на показе.
  const SYSTEM_NOTE_KEY: Record<string, 'noteCreatedViaApi' | 'noteUpdatedViaApi'> = {
    'created via API': 'noteCreatedViaApi',
    'updated via API': 'noteUpdatedViaApi',
  }
  const latestNote = rawNote ? (SYSTEM_NOTE_KEY[rawNote] ? t(SYSTEM_NOTE_KEY[rawNote], lang) : rawNote) : ''
  // «Перевести» и языковой бейдж имеют смысл, ТОЛЬКО если контент реально не на
  // языке зрителя. Русский текст под ключом 'en' (неверный тег генерации) не должен
  // предлагать «перевести на русский» — детектим по самому тексту (кириллица → ru).
  const titleIsForeign = !tpl.title[lang] && detectTextLang(tr(tpl.title, lang), lang) !== lang

  return (
    <>
      {/* Просмотр: владелец себя не накручивает, сервер дополнительно дедупит. */}
      {!isOwner && mon.viewTracking && <ViewBeacon templateId={tpl.id} />}
      {viewer && !readOnlyView && <DigChatHost gnomes={digGnomes} lang={lang} />}
      <div className="print:hidden">
      </div>

      <div className="mx-auto w-full max-w-[1180px] px-4 py-6">
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Основное: содержимое-эталон */}
          <main className="min-w-0 flex-1">
            {/* Заголовок только для печати (в экране он в шапке) */}
            <div className="mb-4 hidden print:block">
              <h1 className="text-[20px] font-bold text-ink">{tr(tpl.title, lang)}</h1>
              {tr(tpl.desc, lang) && <p className="mt-1 text-[13.5px] text-ink-2">{tr(tpl.desc, lang)}</p>}
              <p className="mt-1 font-mono text-[11px] text-muted">
                {owner}/{slug} · v{currentVersion?.version ?? tpl.currentVersion}
              </p>
            </div>

            {/* About на мобиле — НАВЕРХУ (как GitHub): описание, теги, статы со словами.
                На десктопе всё это в About-сайдбаре справа. */}
            <div className="mb-4 lg:hidden print:hidden">
              {tr(tpl.desc, lang) && <p className="text-[13.5px] leading-snug text-ink-2">{tr(tpl.desc, lang)}</p>}
              {tpl.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tpl.tags.map((tg) => (
                    <Link key={tg} href={`/search?q=${encodeURIComponent(`tag:${tg}`)}`} className="rounded-full bg-(--accent-soft) px-2.5 py-0.5 text-[12px] text-accent">
                      {tg}
                    </Link>
                  ))}
                </div>
              )}
              {/* Сводка (как строка stats у GitHub: stars · forks · watching · Branches).
                  Приватность — только на мобиле: на sm+ она в титул-строке ListHeader. */}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
                {tpl.visibility === 'private' && (
                  <span className="inline-flex items-center gap-1.5 text-ink-2 sm:hidden"><Lock size={14} className="text-muted" /> {t('privateLabel', lang)}</span>
                )}
                <span className="inline-flex items-center gap-1.5"><Star size={14} className="text-muted" /> <b className="text-ink">{tpl.starsCount}</b> {t('starsLabel', lang)}</span>
                <span className="inline-flex items-center gap-1.5"><GitFork size={14} className="text-muted" /> <b className="text-ink">{tpl.forksCount}</b> {t('forksLabel', lang)}</span>
                <Link href={`${base}/insights`} className="inline-flex items-center gap-1.5 hover:text-accent"><Eye size={14} className="text-muted" /> <b className="text-ink">{tpl.viewsCount}</b> {t('viewsLabel', lang)}</Link>
                <Link href={`${base}/versions`} className="inline-flex items-center gap-1.5 hover:text-accent"><GitBranch size={14} className="text-muted" /> <b className="text-ink">{Math.max(1, branches.length)}</b> {t('branchesLabel', lang)}</Link>
                <Link href={`${base}/versions`} className="inline-flex items-center gap-1.5 hover:text-accent"><Tag size={14} className="text-muted" /> v{currentVersion?.version ?? tpl.currentVersion}</Link>
              </div>
            </div>

            {tpl.status === 'draft' && isOwner && (
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warn bg-surface px-4 py-3 print:hidden">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-warn">
                    <FileText size={15} /> {t('draftBadge', lang)}
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-ink-2">{t('draftHint', lang)}</p>
                </div>
                <form action={publishList.bind(null, tpl.id)}>
                  <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13px] font-semibold text-primary-fg">
                    <Rocket size={14} /> {t('publish', lang)}
                  </button>
                </form>
              </div>
            )}
            {tpl.origin === 'ai_draft' && tpl.status === 'published' && (
              <DismissibleHint
                storageKey={`hint:ai-draft:${tpl.id}`}
                className="mb-4 rounded-lg border border-(--accent) bg-(--accent-soft) px-4 py-3 text-[13px] text-accent print:hidden"
              >
                <Sparkles size={15} className="shrink-0" /> {t('aiVerifyHint', lang)}
              </DismissibleHint>
            )}
            {/* РФ-маркировка «Реклама» — до ссылок; компактная пометка (сам erid
                едет в ссылке через /api/go). ч. 16 ст. 18.1 требует назвать
                рекламодателя — добавляем наименование+ИНН из правил. */}
            {showAdMarking && (
              <div className="mb-2 inline-flex flex-wrap items-center gap-x-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-ink-2">
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
              <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-4 py-3 text-[12.5px] text-ink-2">
                <Info size={15} className="shrink-0 text-muted" /> {mon.disclosureText}
              </div>
            )}

            {/* Панель над списком (как у GitHub над файлами). Мобильная логика
                (фидбек владельца): ДВЕ плотные строки — (1) инфо: ветка · аватар ·
                ник · vN · ⚒ · время; (2) действия ВПРАВО: Run · Получить · ✎.
                Всё лишнее для узкого экрана (note, счётчики, blame) — только sm+.
                На sm+ прежний вид: инфо слева, действия справа. */}
            {currentVersion && (
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] print:hidden sm:px-3.5">
                <div className="flex min-w-0 flex-1 items-center gap-2 sm:min-w-[240px]">
                  {/* Пикер веток показываем ВСЕГДА, когда ветка есть (как GitHub «main ▾» —
                      даже одна ветка и на чужом списке; canManage лишь гейтит создание). */}
                  {branches.length > 0 && (
                    <BranchPicker base={base} owner={owner} slug={slug} branches={branches} current={refBranch ?? 'main'} lang={lang} canManage={canManageBranches} />
                  )}
                  <Avatar handle={tpl.owner.handle} avatarUrl={tpl.owner.avatarUrl} size={20} />
                  <Link href={`/${tpl.owner.handle}`} className="min-w-0 truncate font-semibold text-ink hover:text-accent">
                    {tpl.owner.handle}
                  </Link>
                  {/* Версию тут НЕ показываем — она только в сайдбаре Releases (убран дубль v1×3). */}
                  {latestNote && <span className="hidden min-w-0 flex-1 truncate text-ink-2 sm:inline">{latestNote}</span>}
                  <span className="ml-auto shrink-0 whitespace-nowrap text-muted">{timeAgo(currentVersion.createdAt, lang)}</span>
                  {/* История коммитов и blame переехали в «...»-меню действий справа. */}
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2 max-sm:w-full max-sm:justify-end">
                  {tpl.isTemplate && viewer && (
                    <form action={useTemplate.bind(null, tpl.id)} className="inline-flex">
                      <Tooltip label={lang === 'ru' ? 'Создать свой список из этого шаблона' : 'Start your own list from this template'}>
                        <button
                          type="submit"
                          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-semibold text-ink hover:border-border-strong"
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
                    versionsCount={tpl.versions.length}
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
                        <button aria-label={t('runStart', lang)} className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-fg hover:opacity-90">
                          <PlayCircle size={16} />
                        </button>
                      </Tooltip>
                    </form>
                  )}
                </div>
              </div>
            )}

            {/* Просмотр «на коммите»: снимок списка, каким он был тогда. Отдельная
                плашка, а не ветковая: у коммита нет ahead/behind, и предлагать
                «открыть pull request» с исторического снимка бессмысленно. */}
            {refCommit && snapshot && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-ink print:hidden">
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
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-[12.5px] text-ink print:hidden">
                <GitCommitHorizontal size={13} className="shrink-0 text-warn" />
                <span>
                  {lang === 'ru' ? 'Ветка' : 'Branch'} <b className="font-mono">{refBranch}</b> · +{branchInfo.ahead}/-{branchInfo.behind}{' '}
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
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-accent/50 bg-accent/10 px-3 py-2 text-[12.5px] text-ink print:hidden">
                <Tag size={13} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate">
                  {say('Version', 'Версия')} <b>v{histNum}</b>
                  <span className="hidden sm:inline">
                    {' '}
                    · {timeAgo(histVer.createdAt, lang)} ·{' '}
                    {say(`read-only, current is v${curNum}`, `только чтение, текущая — v${curNum}`)}
                  </span>
                </span>
                <span className="flex items-center gap-2 max-sm:w-full max-sm:justify-end">
                  {canManageBranches && (
                    <form action={revertToVersion.bind(null, tpl.id, histNum)}>
                      <Button type="submit" variant="primary" className="h-[38px]">
                        <History size={13} />
                        <span className="max-sm:hidden">{say('Restore this version', 'Вернуть эту версию')}</span>
                        <span className="sm:hidden">{say('Restore', 'Вернуть')}</span>
                      </Button>
                    </form>
                  )}
                  <Link href={base}>
                    <Button variant="outline" className="h-[38px]">
                      {say(`To v${curNum}`, `К v${curNum}`)}
                    </Button>
                  </Link>
                </span>
              </div>
            )}
            {/* Результат поиска внутри списка (?find=). */}
            {find && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-(--accent)/50 bg-(--accent-soft) px-3 py-2 text-[12.5px] text-ink print:hidden">
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
                  <h2 id={sectionAnchor(section)} className={`scroll-mt-24 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-2 ${si > 0 ? 'mt-3' : ''}`}>
                    {section}
                  </h2>
                ) : null

                // Quiz-gate: блоки заблокированного урока не показываем; на первом —
                // карточка-замок «пройдите тесты предыдущего урока».
                if (firstLockedIdx >= 0 && lessonOfBlock[si] >= gatedFromLesson) {
                  if (si !== firstLockedIdx) return null
                  const prevLesson = lessons[gatedFromLesson - 1]
                  return (
                    <div key={s.id} className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-surface-2 px-4 py-5 text-[13px] text-ink-2">
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
                    el = md ? (
                      <div className="break-inside-avoid px-1 py-1">
                        <Markdown className="text-[14px] leading-relaxed text-ink-2">{renderWikiLinks(md)}</Markdown>
                      </div>
                    ) : null
                  } else if (s.type === 'image') {
                    const ref = typeof s.content?.ref === 'string' ? s.content.ref : ''
                    const url = ref ? blockImages[ref] : ''
                    const caption = typeof s.content?.caption === 'string' ? s.content.caption : ''
                    el = url ? (
                      <figure className="break-inside-avoid">
                        <SmartImage src={url} alt={caption || t('screenshot', lang)} className="max-h-[520px] w-auto rounded-lg border border-border" />
                        {caption && <figcaption className="mt-1.5 text-[12.5px] text-muted">{caption}</figcaption>}
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
                      <SafeLink href={url} className="inline-flex max-w-full items-center gap-2 break-inside-avoid rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-accent hover:border-border-strong">
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
                          canVote={!!viewer}
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
                          canSubmit={!!viewer}
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
                        <DigChatOpen detail={{ templateId: tpl.id, stepN: s.n, stepTitle: tr(s.title, lang) }} label={say('Dig into this step', 'Копнуть этот пункт')} hasSession={digSteps.has(s.n)} />
                      </span>
                    )}
                    <div className="flex gap-3">
                      <span className="mt-0.5 font-mono text-[13px] text-muted">{tpl.ordered ? displayNum[si] : '•'}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 pr-7">
                          <span className="text-[14.5px] font-semibold text-ink">{tr(s.title, lang)}</span>
                          <StepLevelBadge level={s.level} lang={lang} />
                        </div>
                        {tr(s.desc, lang) && <Markdown className="mt-1">{renderWikiLinks(tr(s.desc, lang))}</Markdown>}
                        {tr(s.why, lang) && (
                          <div className="mt-1.5 flex gap-1.5 text-[12.5px] text-ink-2">
                            <Info size={13} className="mt-0.5 shrink-0 text-muted" />
                            <span>
                              <span className="font-medium text-ink-2">{t('whyLabel', lang)}:</span> {tr(s.why, lang)}
                            </span>
                          </div>
                        )}
                        {/* «ЗДЕСЬ НУЖЕН ЧЕЛОВЕК»: место, где машина честно не знает —
                            местные цены, вкус, время на вашем оборудовании. Не дефект, а
                            приглашение: реальный опыт доступен человеку, не модели.
                            Приглашение ведёт в тот же поток правки, что и кнопка сверху. */}
                        {s.needsHuman && (
                          <div className="mt-1.5 flex gap-1.5 rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-2 text-[12.5px] text-ink-2">
                            <UserRound size={13} className="mt-0.5 shrink-0 text-muted" />
                            <span className="min-w-0">
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
                            className="mt-3 max-h-[420px] w-auto rounded-lg border border-border"
                          />
                        )}
                        {s.command && (
                          <div className="mt-3 flex items-center gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 font-mono text-[12px] text-ink">
                            <span className="shrink-0" style={{ color: 'var(--accent)' }}>$</span>
                            {/* Горизонтальный скролл + выделение: можно доскроллить до конца строки
                                и выделить/скопировать её часть, а не только всю через кнопку. */}
                            <span className="no-scrollbar min-w-0 flex-1 select-text overflow-x-auto whitespace-nowrap">{s.command}</span>
                            <CopyButton text={s.command} />
                          </div>
                        )}
                        {subs.length > 0 && (
                          <div className="mt-3">
                            {/* subtasks — критерии проверки шага (см. промпт генерации:
                                «verification checks»), а не под-шаги: подписываем и рисуем
                                чек-квадратами, иначе выглядят оторванным списком. */}
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                              {t('stepChecksLabel', lang)}
                            </div>
                            <ul className="flex flex-col gap-1.5">
                              {subs.map((label, i) => (
                                <li key={i} className="flex gap-2 text-[13px] text-ink-2">
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
                              const cls =
                                'inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[11.5px] text-accent'
                              return r.url ? (
                                <SafeLink key={`${r.label}:${r.url}`} href={r.href ?? r.url} rel="nofollow noreferrer" className={cls}>
                                  <ExternalLink size={11} /> {r.label}
                                </SafeLink>
                              ) : (
                                <span key={`${r.label}:`} className={cls}>
                                  <ExternalLink size={11} /> {r.label}
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
              <AsideCard title={say('Linked from', 'Ссылаются на этот список')}>
                <ul className="flex flex-col gap-1.5">
                  {backlinks.map((b) => (
                    <li key={`${b.handle}/${b.slug}`}>
                      <Link href={`/${b.handle}/${b.slug}`} className="block truncate text-[13px] text-accent hover:underline">
                        {tr(b.title as LocaleText, lang) || `${b.handle}/${b.slug}`}
                      </Link>
                    </li>
                  ))}
                </ul>
              </AsideCard>
            )}
            <div className="rounded-lg border border-border bg-surface p-4">
              <SectionLabel className="mb-2">
                {t('about', lang)}
              </SectionLabel>
              {tr(tpl.desc, lang) && <p className="text-[13.5px] leading-relaxed text-ink-2">{tr(tpl.desc, lang)}</p>}
              {tpl.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {tpl.tags.map((tag) => (
                    <Link
                      key={tag}
                      href={`/search?q=${encodeURIComponent(`tag:${tag}`)}`}
                      className="rounded-full bg-(--accent-soft) px-2.5 py-0.5 text-[12px] font-medium text-accent hover:underline"
                    >
                      {tag}
                    </Link>
                  ))}
                </div>
              )}
              <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3 text-[13px] text-ink-2">
                <span className="inline-flex items-center gap-2">
                  <Star size={14} /> <b className="text-ink">{fmt(tpl.starsCount)}</b> stars
                </span>
                <span className="inline-flex items-center gap-2">
                  <GitFork size={14} /> <b className="text-ink">{fmt(tpl.forksCount)}</b> forks
                </span>
                <Link href={`${base}/releases`} className="inline-flex items-center gap-2 hover:text-accent">
                  <Tag size={14} /> {t('releasesLabel', lang)}:{' '}
                  <b className="text-ink">v{currentVersion?.version ?? tpl.currentVersion}</b>
                  <span className="rounded-full bg-ok/15 px-1.5 py-0.5 text-[10px] font-semibold text-ok">{t('latest', lang)}</span>
                </Link>
                <span>
                  {t('maintainedBy', lang)}{' '}
                  <Link href={`/${tpl.owner.handle}`} className="text-ink-2 hover:text-accent">
                    {tpl.owner.name ?? tpl.owner.handle}
                  </Link>
                </span>
                {!isOwner && <ReportButton templateId={tpl.id} lang={lang} />}
              </div>

              {lineage && <ListLineage lineage={lineage} exact={lineageExact} gnomeNames={lineageNames} lang={lang} />}

              {contributors.length > 0 && (
                <div className="mt-4 border-t border-border pt-3">
                  <SectionLabel className="mb-2 flex items-center gap-1.5">
                    <Users size={12} /> {t('contributors', lang)} <span className="text-ink-2">{contributors.length}</span>
                  </SectionLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {contributors.slice(0, 14).map((c) => (
                      <Tooltip key={c.handle} label={c.handle}>
                        <Link href={`/${c.handle}`} className="hover:opacity-80">
                          <Avatar handle={c.handle} avatarUrl={c.avatarUrl} size={28} />
                        </Link>
                      </Tooltip>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </PageAside>
        </div>
      </div>
    </>
  )
}
