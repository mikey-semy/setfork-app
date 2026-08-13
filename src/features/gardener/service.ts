import 'server-only'
import { eq } from 'drizzle-orm'
import { db, suggestions } from '@/shared/db'
import { sql } from 'drizzle-orm'
import { notify } from '@/features/notifications/notify'
import { generateListRefine, type GeneratedItem } from '@/shared/ai/generate'
import { policyFor } from '@/shared/ai/gardener-policies'
import { globalBudgetOk } from '@/shared/quota'
import { checkUrls } from '@/shared/lib/link-health'
import { freshestUsedAt } from '@/shared/ai/feed-pick'
import { isAiAvailable } from '@/shared/settings/ai'
import { log } from '@/shared/observability'
import { toProposed } from '@/shared/lib/step-input'
import { agentUserIds, professionOf, tenderForTags } from '@/shared/ai/gnome-account'
import { loopPolicy, recordAgentAction, type AgentActionInput } from '@/shared/agents/policy'
import { autonomyHealthy } from '@/shared/agents/canary'
import { getRoster } from '@/shared/ai/roster'
import { t } from '@/shared/i18n'

import { ensureGardenerUser } from './sweep/account'
import { alreadyForked, pickCandidates, stablePasses } from './sweep/candidates'
import { BATCH } from './sweep/schedule'
import { noteFor, policyOverrides } from './sweep/policy'
import { gateOwnDraft } from './sweep/readiness-gate'
import { divergeByFork, STABLE_PASSES_BEFORE_FORK } from './sweep/diverge'
import { growLiving } from './sweep/living'
import { snapshotOf } from './sweep/snapshot'
import { publishGardenerVersion } from './sweep/publish'

// ── ИИ-садовник (Э2 → ось B «живые списки») ──────────────────────────
// Прозрачный ИИ-участник: раз в GARDENER_EVERY_DAYS (см. sweep/schedule) выбирает
// несколько публичных списков и предлагает улучшения ОБЫЧНОЙ правкой (PR-модель) от
// сервисного аккаунта `gardener` — владелец ревьюит и принимает/отклоняет. Ничего не
// публикуется автоматически. Расход пишется в ai_usage (feature 'refine').
// Правка идёт НА ЯЗЫКЕ СПИСКА и ПО ПОЛИТИКЕ ЕГО ТИПА (рецепт: точные
// количества; процедура: актуальность команд — см. gardener-policies).
//
// Здесь остаётся только ПРОХОД — очерёдность решений над одним списком. Что именно
// делает каждое решение, живёт рядом в `sweep/`:
//
// | модуль | меняется, когда |
// |---|---|
// | `schedule` | меняется ритм ухода (он же окно «недавно предлагали») |
// | `account` | меняется сервисный аккаунт и постановка следующей задачи |
// | `candidates` | меняется, кого считаем заброшенным списком |
// | `policy` | меняются правила для типа списка и подпись правки |
// | `readiness-gate` | меняются правила «публиковать без человека» |
// | `diverge` | меняется ответ «полировать дальше или разойтись» |
// | `living` | меняется, как поток превращается в пункты ленты |

// Вход прежний: снаружи садовник — по-прежнему один модуль.
export { ensureGardenerScheduled, ensureGardenerUser } from './sweep/account'
export { alreadyForked, pickCandidates, stablePasses } from './sweep/candidates'
export { gateOwnDraft } from './sweep/readiness-gate'
export { growLiving } from './sweep/living'

/** Прогон садовника: до BATCH списков за раз, каждый — refine → suggestion. */
export async function runGardenerSweep(): Promise<{ proposed: number; skipped: number; published: number; diverged: number }> {
  if (!(await isAiAvailable())) {
    log.info('gardener: AI unavailable, skipping')
    return { proposed: 0, skipped: 0, published: 0, diverged: 0 }
  }
  // Фоновый расход без участия человека — уважаем глобальный дневной кап инстанса.
  if (!(await globalBudgetOk())) {
    log.info('gardener: global AI budget exhausted, skipping')
    return { proposed: 0, skipped: 0, published: 0, diverged: 0 }
  }
  // Здоровье автономии — ДО работы: серия ошибок или снятая модерацией автопубликация
  // срывают предохранитель, и проход не начинается (снимает предохранитель только человек).
  if (!(await autonomyHealthy('gardener'))) {
    log.warn?.('gardener: circuit tripped by canary, skipping sweep')
    return { proposed: 0, skipped: 0, published: 0, diverged: 0 }
  }
  const loop = await loopPolicy('gardener')
  const gardener = await ensureGardenerUser()
  const [agents, roster] = await Promise.all([agentUserIds(), getRoster()])
  // Партия прохода: лентам отдаём не больше половины. Иначе, как только живых списков станет
  // три (размер партии), обычные списки перестали бы обслуживаться совсем — уход выродился бы
  // в одну только ленту (находка Codex на #535).
  const livingCap = Math.max(1, Math.floor(BATCH / 2))
  const [livingPicked, ordinary, overrides] = await Promise.all([
    pickCandidates(agents, livingCap, 'living'),
    pickCandidates(agents, BATCH, 'ordinary'),
    policyOverrides(),
  ])
  const candidates = [...livingPicked, ...ordinary.slice(0, BATCH - livingPicked.length)]

  let proposed = 0
  let skipped = 0
  let published = 0
  let diverged = 0
  // Списки обрабатываются ПОСЛЕДОВАТЕЛЬНО намеренно, и распараллелить их нельзя:
  // каждая итерация зовёт платную модель, а глобальный бюджет и суточная квота
  // автопубликаций проверяются ПО ХОДУ. Запустив партию разом, мы бы узнавали об
  // исчерпании бюджета уже после того, как заплатили за всю партию.
  for (const tpl of candidates) {
    const { lang, kind, current } = await snapshotOf(tpl)

    // Сорняки (HQ §9): обход ссылок списка КОДОМ до refine. Уверенно мёртвые
    // (404/410) отдаём садовнику-LLM на замену — подбор живого источника как раз
    // его работа. 'unknown' (geo-блок/бот-защита с RU-сервера) не трогаем.
    const refUrls = current.items.flatMap((it) => it.refs.map((r) => r.url)).filter(Boolean)
    const verdicts = refUrls.length ? await checkUrls(refUrls) : new Map<string, string>()
    const deadUrls = [...verdicts.entries()].filter(([, v]) => v === 'dead').map(([u]) => u)
    // Инструкция = политика ТИПА списка (+ замена мёртвых ссылок, если нашлись).
    const policy = policyFor(kind, overrides)
    const instruction = deadUrls.length
      ? `${policy}\nDEAD LINKS (verified 404/410 by the site, not a guess) — replace each with a working authoritative source or drop the ref: ${deadUrls.join(' ')}`
      : policy

    // Шляпу садовника надевает ПРОФИЛЬНЫЙ специалист (решение владельца): кулинарный
    // список правит повар — он в рецептах и разбирается. «Садовник» остаётся именем
    // функции (следить за ростом качества), а не отдельным персонажем. Никто по домену
    // не подошёл → общий служебный аккаунт, как раньше.
    const tender = await tenderForTags(tpl.tags, roster)
    const tenderId = tender?.userId ?? gardener.id
    const ownedByCompany = tpl.ownerAccountType === 'agent'
    // Кто взял список: id — для журнала и gateCtx, профессия — для решения. Читаем один раз.
    const expertId = tender?.expert.id ?? ''
    const gateCtx = { tenderId, agentId: expertId, policyVersion: loop.policyVersion, lang }

    /**
     * Запись в журнал по ЭТОМУ списку. Обвязка (кто, по какому списку, какой политикой)
     * у всех веток прохода одна, а собиралась руками в каждой — и разъехалась дважды:
     * две самые частые ветки не писали НИЧЕГО, а три клали сигнал без `templateId`.
     * По нему правило остановки ищет прошлые действия, так что «правка» не обнуляла
     * счётчик «устоялся» — список уходил в форк раньше времени. Теперь забыть нельзя.
     */
    const journal = (
      action: string,
      resultStatus: AgentActionInput['resultStatus'],
      decision: Record<string, unknown>,
      signal: Record<string, unknown> = {},
    ) =>
      recordAgentAction({
        loop: 'gardener',
        action,
        resultStatus,
        agentId: expertId,
        actorUserId: tenderId,
        signal: { templateId: tpl.id, slug: tpl.slug, ...signal },
        decision,
        resultRef: tpl.slug,
        policyVersion: loop.policyVersion,
      })
    /** Профиль мастера, взявшего список, — «кто именно» в решении. */
    const byWhom = tender ? professionOf(tender.expert, 'en') : 'generic'

    // СУХОЙ ПРОГОН: кого выбрали и что нашли — в журнал, refine НЕ зовём (он платный).
    // Проверка стоит до вызова модели и после выбора мастера, чтобы в журнале было
    // видно настоящее решение петли, а не заготовку.
    if (loop.dryRun) {
      await journal(
        ownedByCompany ? 'list.improve' : 'list.suggest',
        'dry-run',
        { mode: ownedByCompany ? 'direct-edit' : 'suggestion', profession: byWhom },
        { trigger: 'schedule', deadLinks: deadUrls.length },
      )
      skipped++
      continue
    }

    // ЖИВОЙ СПИСОК растёт, а не полируется: ветка стоит ДО refine, потому что полировать
    // ленту незачем — её ценность в свежести. Нет новостей → уходим молча и БЕЗ вызова
    // модели: «нет новостей» это не «устоялся», и правило остановки к ленте не применяется,
    // иначе тихая неделя уводила бы ленту в форк.
    // Рост напрямую — только по СВОИМ спискам. Живой список человека компания правит обычным
    // путём, предложением: писать в чужой список от своего имени нельзя, даже если владелец
    // включил «живой» (находка ревьюера Codex на #535).
    if (tpl.living) {
      const res = await growLiving(tpl, current, lang, kind, {
        ...gateCtx,
        domains: tender?.expert.domains,
        mode: ownedByCompany ? 'version' : 'suggestion',
        ownerId: tpl.ownerId,
        baseVersion: tpl.currentVersion,
      })
      if (res.result === 'grown') {
        proposed++
        // Выросшая лента идёт на планку — она судит её свежестью, а не полнотой. Иначе
        // самое живое, что есть у компании, вечно лежало бы в черновиках.
        if (ownedByCompany && tpl.status === 'draft' && res.snapshot) {
          const fresh = await freshestUsedAt(tpl.id)
          const ageDays = fresh ? Math.floor((Date.now() - fresh.getTime()) / 86_400_000) : undefined
          const gated = await gateOwnDraft({ ...tpl, living: true, freshestAgeDays: ageDays }, res.snapshot, gateCtx)
          if (gated === 'published') published++
        }
      } else {
        if (res.result === 'nothing-new') {
          await journal('list.fresh-none', 'skipped', { reason: 'living list: the stream had nothing new' })
        }
        skipped++
      }
      continue
    }

    // Бюджет перепроверяем ПЕРЕД каждым платным вызовом, а не только на входе в
    // проход. Комментарий выше обещал, что «бюджет и квота проверяются по ходу», но
    // по ходу проверялась только квота: расхождение форком и гейт готовности бюджет
    // спрашивали, а сам refine — самый дорогой шаг — нет. Находка A3 линзы 06.
    if (!(await globalBudgetOk())) {
      log.info('gardener: budget exhausted mid-batch, stopping', { proposed, planned: candidates.length })
      break
    }
    const refined = await generateListRefine(current, instruction, lang, {
      userId: tenderId,
      feature: 'refine',
      refType: 'template',
      refId: tpl.id,
      kind,
    })
    if (!refined || !refined.items.length) {
      skipped++
      continue
    }
    // Без изменений — правку не открываем (сравнение по нормализованному контенту).
    const norm = (xs: GeneratedItem[]) => JSON.stringify(toProposed(xs, lang))
    if (norm(refined.items) === norm(current.items as GeneratedItem[])) {
      // Для СВОЕГО черновика «улучшать нечего» — не пропуск, а сигнал: список устоялся,
      // самое время спросить планку.
      if (ownedByCompany && tpl.status === 'draft') {
        const res = await gateOwnDraft(tpl, { ...current, items: current.items }, gateCtx)
        if (res === 'published') published++
      }
      // «Устоялся» пишем в журнал — по нему и считается правило остановки.
      await journal('list.stable', 'skipped', { reason: 'refine returned the same content' })
      // Два прохода подряд без изменений → хватит полировать. РАСХОДИМСЯ форком: другой
      // мастер уводит список в другой контекст. Один форк на источник.
      if ((await stablePasses(tpl.id)) >= STABLE_PASSES_BEFORE_FORK && !(await alreadyForked(tpl.id, agents))) {
        const forked = await divergeByFork(tpl, current, lang, kind, { roster, excludeUserId: tenderId, agents, policyVersion: loop.policyVersion })
        if (forked) diverged++
      }
      skipped++
      continue
    }

    const items = toProposed(refined.items, lang)
    const note = noteFor(kind, lang) + (deadUrls.length ? ' ' + t('gardenerNoteDeadLinks', lang).replace('{n}', String(deadUrls.length)) : '')

    // СВОЙ СПИСОК компания правит НАПРЯМУЮ. Предложение самому себе — церемония без
    // получателя: принимать его некому, и оно просто копилось бы открытым. Именно из-за
    // такого разрыва всё, созданное компанией, ранее не улучшалось вовсе.
    // РЕЦЕПТ — исключение из прямой правки, и оно шире, чем «кураторские».
    // Ниже стоит защита: количества, переписанные моделью, требуют человеческого
    // глаза. Но ветка «свой список компании» возвращалась ДО неё, и рецепт компании
    // переписывался сразу — то есть защита существовала ровно для чужих списков, а
    // для своих её обходила очерёдность проверок. Ценность правки не теряем:
    // открываем предложение, оно ждёт человека.
    if (ownedByCompany && kind === 'recipe') {
      const [rec] = await db
        .insert(suggestions)
        .values({
          templateId: tpl.id,
          authorId: tenderId,
          note,
          baseVersion: tpl.currentVersion,
          items,
          number: sql`(select coalesce(max(number), 0) + 1 from suggestions where template_id = ${tpl.id})`,
        })
        .returning({ id: suggestions.id })
      await journal(
        'list.suggest',
        'ok',
        { mode: 'suggestion', reason: 'recipe — правку количеств смотрит человек', profession: byWhom },
        { trigger: 'schedule', deadLinks: deadUrls.length },
      )
      proposed++
      log.info('gardener: recipe suggestion opened on own list', { slug: tpl.slug, suggestionId: rec.id })
      continue
    }

    if (ownedByCompany) {
      await publishGardenerVersion(tpl.id, items, { note, authorId: tenderId })
      await journal(
        'list.improve',
        'ok',
        { mode: 'direct-edit', reason: 'company-owned list — no receiver for a suggestion', profession: byWhom },
        { trigger: 'schedule', deadLinks: deadUrls.length },
      )
      proposed++
      log.info('gardener: own list improved directly', { slug: tpl.slug, tender: expertId || 'generic' })
      // Улучшили свой черновик → сразу спрашиваем планку по НОВОМУ содержимому.
      if (tpl.status === 'draft') {
        const res = await gateOwnDraft(tpl, { title: current.title, desc: current.desc, tags: current.tags, items: refined.items }, gateCtx)
        if (res === 'published') published++
      }
      continue
    }

    const [created] = await db
      .insert(suggestions)
      .values({
        templateId: tpl.id,
        authorId: tenderId,
        note,
        baseVersion: tpl.currentVersion,
        items,
        number: sql`(select coalesce(max(number), 0) + 1 from suggestions where template_id = ${tpl.id})`,
      })
      .returning({ id: suggestions.id })

    // Рецепты НЕ авто-мёрджим даже на кураторских — правка количеств требует
    // человеческого глаза, пока качество recipe-политики не оценено вручную.
    if (tpl.ownerCurated && kind !== 'recipe') {
      // Кураторская библиотека — контент сайта: правка садовника применяется сразу
      // (та же механика, что acceptSuggestion), с атрибуцией в истории и модерацией.
      // recheck публичного списка — в фасаде listStore.addVersion (барьер), здесь не дублируем.
      // Пометка «принято» идёт ДО уведомлений (afterVersion), а не после: сбой
      // уведомления или переиндексации иначе оставил бы предложение открытым при уже
      // записанной версии — и следующий проход смёржил бы его повторно.
      await publishGardenerVersion(tpl.id, items, {
        note: '\u{1F9D9} gardener: refreshed steps',
        authorId: tenderId,
        afterVersion: async () => {
          await db.update(suggestions).set({ status: 'accepted', resolvedAt: new Date() }).where(eq(suggestions.id, created.id))
        },
      })
      await journal(
        'list.improve',
        'ok',
        { mode: 'auto-merge', reason: 'curated library — the gardener edit is the site content', profession: byWhom },
        { trigger: 'schedule', deadLinks: deadUrls.length },
      )
      log.info('gardener: auto-merged on curated list', { slug: tpl.slug })
    } else {
      await notify({ recipientId: tpl.ownerId, actorId: tenderId, type: 'suggestion_new', templateId: tpl.id, suggestionId: created.id })
      // Запись в журнал — не отчётность ради отчётности: по нему считается «День
      // компании» и правило остановки. Самая частая ветка прохода не писала в него
      // НИЧЕГО, и владелец видел пустой день при работающей компании.
      await journal('list.suggest', 'ok', { mode: 'suggestion', profession: byWhom }, { trigger: 'schedule', deadLinks: deadUrls.length })
      log.info('gardener: suggestion opened', { slug: tpl.slug, suggestionId: created.id, tender: expertId || 'generic' })
    }
    proposed++
  }
  log.info('gardener sweep done', { candidates: candidates.length, proposed, skipped, published, diverged })
  return { proposed, skipped, published, diverged }
}
