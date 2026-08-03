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
import { StepLevelBadge } from '@/shared/ui/StepLevelBadge'
import { timeAgo } from '@/shared/ui/timeAgo'
import { getContributors, getStepPreviews, getVersionAuthors, getVersionSteps } from '@/features/library/queries'
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
import { ViewBeacon } from '@/features/analytics/ViewBeacon'
import { ListActionsMenu } from '@/features/library/ListActionsMenu'
import { ReportButton } from '@/features/reports/ReportButton'
import { publishList } from '@/features/library/actions'
import { PAGE } from '@/shared/ui/control'

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
  //
  // Голосование в опросе и ответ в квизе — тоже запись, и она шла МИМО этого флага:
  // экшены разрешают bid по ТЕКУЩЕЙ версии, поэтому клик по старому варианту опроса
  // писал живой голос, а ответ в старом квизе перезаписывал текущую попытку — старый
  // ответ оценивался по новому содержанию (P1 из авто-ревью). В снимке эти действия
  // выключены: смотреть прошлое можно, писать в него — нет.
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
  // Писать можно только в текущую версию — см. readOnlyView выше.
  const canInteract = !!viewer && !readOnlyView
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
  // Состояние quiz-блоков (последняя попытка зрителя — по content.bid). Вместе с bid
  // считаем отпечаток ТЕКУЩЕГО содержимого: ответ на прежнюю редакцию вопроса не
  // должен показываться пройденным — иначе страница открывала бы зависимые уроки,
  // тогда как выдача сертификата требует пересдачи.
  const quizBids: string[] = []
  const quizHashes = new Map<string, string>()
  for (const s of steps) {
    if (s.type !== 'quiz') continue
    const c = (s.content ?? {}) as Record<string, unknown>
    if (typeof c.bid !== 'string') continue
    quizBids.push(c.bid)
    quizHashes.set(c.bid, quizContentHash(c))
  }
  const quizStates = quizBids.length ? await getQuizState(tpl.id, quizBids, viewer?.userId, quizHashes) : {}
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
  // Наблюдатели — для сводки показателей (ListStats): в самом tpl их нет.
  // Авторы ПОСЛЕДНЕЙ версии (их может быть несколько — принятая правка с соавторами) и
  // число версий: и то и другое стоит в строке коммита, как у GitHub.
  const [contributors, watchers, versionAuthors] = await Promise.all([
    getContributors(tpl.id, tpl.ownerId),
    getWatchCount(tpl.id),
    currentVersion ? getVersionAuthors(tpl.id, currentVersion.version) : Promise.resolve([]),
  ])
  const commitsCount = tpl.versions.length
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

      <div className={PAGE}>
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Основное: содержимое-эталон */}
          <main className="min-w-0 flex-1">
            {/* Заголовок только для печати (в экране он в шапке) */}
            <div className="mb-4 hidden print:block">
              <h1 className="text-[1.25rem] font-bold text-ink">{tr(tpl.title, lang)}</h1>
              {tr(tpl.desc, lang) && <p className="mt-1 text-[0.8125rem] text-ink-2">{tr(tpl.desc, lang)}</p>}
              <p className="mt-1 font-mono text-[0.6875rem] text-muted">
                {owner}/{slug} · v{currentVersion?.version ?? tpl.currentVersion}
              </p>
            </div>

            {/* About на мобиле — НАВЕРХУ (как GitHub): описание, теги, статы со словами.
                На десктопе всё это в About-сайдбаре справа. */}
            <div className="mb-4 lg:hidden print:hidden">
              {tr(tpl.desc, lang) && <p className="text-[0.8125rem] leading-snug text-ink-2">{tr(tpl.desc, lang)}</p>}
              {tpl.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tpl.tags.map((tg) => (
                    <Link key={tg} href={`/search?q=${encodeURIComponent(`tag:${tg}`)}`} className="rounded-full bg-(--accent-soft) px-2.5 py-0.5 text-[0.78125rem] text-accent">
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

            {tpl.status === 'draft' && isOwner && (
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warn bg-surface px-4 py-3 print:hidden">
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
                className="mb-4 rounded-lg border border-(--accent) bg-(--accent-soft) px-4 py-3 text-[0.8125rem] text-accent print:hidden"
              >
                <Sparkles size={15} className="shrink-0" /> {t('aiVerifyHint', lang)}
              </DismissibleHint>
            )}
            {/* РФ-маркировка «Реклама» — до ссылок; компактная пометка (сам erid
                едет в ссылке через /api/go). ч. 16 ст. 18.1 требует назвать
                рекламодателя — добавляем наименование+ИНН из правил. */}
            {showAdMarking && (
              <div className="mb-2 inline-flex flex-wrap items-center gap-x-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[0.6875rem] font-medium text-ink-2">
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
              <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-4 py-3 text-[0.78125rem] text-ink-2">
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
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[0.78125rem] text-ink-2 print:hidden">
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
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[0.78125rem] text-ink print:hidden">
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
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-[0.78125rem] text-ink print:hidden">
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
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-accent/50 bg-accent/10 px-3 py-2 text-[0.78125rem] text-ink print:hidden">
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
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-(--accent)/50 bg-(--accent-soft) px-3 py-2 text-[0.78125rem] text-ink print:hidden">
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
                  <h2 id={sectionAnchor(section)} className={`scroll-mt-24 text-[0.8125rem] font-semibold uppercase tracking-[0.06em] text-ink-2 ${si > 0 ? 'mt-3' : ''}`}>
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
                          <span className="text-[0.875rem] font-semibold text-ink">{tr(s.title, lang)}</span>
                          <StepLevelBadge level={s.level} lang={lang} />
                        </div>
                        {tr(s.desc, lang) && <Markdown className="mt-1">{renderWikiLinks(tr(s.desc, lang))}</Markdown>}
                        {tr(s.why, lang) && (
                          <div className="mt-1.5 flex gap-1.5 text-[0.78125rem] text-ink-2">
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
                          <div className="mt-1.5 flex gap-1.5 rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-2 text-[0.78125rem] text-ink-2">
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
                              {subs.map((label, i) => (
                                <li key={i} className="flex gap-2 text-[0.8125rem] text-ink-2">
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
                                'inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[0.6875rem] text-accent'
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
