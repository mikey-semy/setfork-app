import 'server-only'
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
import { t, tr, type Lang, type LocaleText } from '@/shared/i18n'
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

// Стабильный anchor-id для заголовка урока/секции (для оглавления курса).
export function sectionAnchor(s: string): string {
  return 'lesson-' + s.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

/**
 * Всё, что странице списка нужно знать, прежде чем что-то показать: сам список и его
 * версия, ветки и снимок git, шаги с картинками, опросы и тесты, прогресс курса,
 * происхождение (форки), участники и раскрытие рекламы.
 *
 * Отдельно от разметки: здесь ПРАВИЛА — какую версию показываем, что доступно
 * читателю без сессии, какой урок заблокирован, чей это форк. Там — как это
 * выглядит. Пока они жили одной функцией, страница на тысячу строк открывалась и
 * ради подписи кнопки, и ради правила блокировки урока.
 */
export async function loadListPage({
  owner,
  slug,
  sp,
  lang,
}: {
  owner: string
  slug: string
  sp: Record<string, string | undefined>
  lang: Lang
}) {
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
  // Черновик правок ТЕКУЩЕГО зрителя (у каждого автора свой) — только чтобы показать
  // метку «есть неопубликованные правки»; содержимое списка он не подменяет.
  const myDraft = viewer && !readOnlyView && (isOwner || canManageBranches) ? await getDraft(tpl.id, viewer.userId) : null
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
  // Время берём один раз на загрузку: по нему решается, закрыт ли дедлайн опроса.
  // Правило о чистоте рендера сюда уже не относится — это обычная серверная функция,
  // а не компонент.
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
  return {
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
  }
}
