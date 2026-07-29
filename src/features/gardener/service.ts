import 'server-only'
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { agentActions, appSettings, db, jobs, steps, suggestions, templates, templateVersions, users, type ProposedItem } from '@/shared/db'
import { listStore } from '@/features/library/list-store'
import { notifyMany } from '@/features/notifications/notify'
import { getWatcherIds } from '@/features/watch/queries'
import { enqueueReindex } from '@/features/library/jobs'
import { enqueueJob } from '@/shared/jobs/queue'
import { generateListRefine, type GeneratedItem } from '@/shared/ai/generate'
import { LIST_KINDS, type ListKind } from '@/shared/ai/list-kind'
import { POLICY_SETTING_KEYS, dominantLang, inferListKind, policyFor, policySettingKey } from '@/shared/ai/gardener-policies'
import { globalBudgetOk } from '@/shared/quota'
import { countDuplicateSteps, readinessDecision, structuralBlockers, DEFAULT_BAR, type ReadinessBar, type ReadinessFacts } from '@/shared/ai/readiness'
import { featuresOf, gradeList } from '@/shared/ai/list-grade'
import { runReadinessLenses, type ReadinessInput } from '@/shared/ai/readiness-lenses'
import { checkUrls } from '@/shared/lib/link-health'
import { freshForDomains, freshestUsedAt, markUsed } from '@/shared/ai/feed-pick'
import { getAiSettings, isAiAvailable } from '@/shared/settings/ai'
import { notify } from '@/features/notifications/notify'
import { log } from '@/shared/observability'
import { toProposed, toStepInput } from '@/shared/lib/step-input'
import { HOME_REALM } from '@/shared/ai/gnome-names'
import { agentUserIds, professionOf, tenderForTags } from '@/shared/ai/gnome-account'
import { loopPolicy, recordAgentAction } from '@/shared/agents/policy'
import { autonomyHealthy, publishQuotaLeft } from '@/shared/agents/canary'
import { moderateNewPublication } from '@/shared/agents/publication'
import { getRoster, type Expert } from '@/shared/ai/roster'
import { t, type Lang, type LocaleText } from '@/shared/i18n'
import { uniqueSlug } from '@/shared/lib/slug'

// ── ИИ-садовник (Э2 → ось B «живые списки») ──────────────────────────
// Прозрачный ИИ-участник: раз в GARDENER_EVERY_DAYS выбирает несколько публичных
// списков и предлагает улучшения ОБЫЧНОЙ правкой (PR-модель) от сервисного
// аккаунта `gardener` — владелец ревьюит и принимает/отклоняет. Ничего не
// публикуется автоматически. Расход пишется в ai_usage (feature 'refine').
// Правка идёт НА ЯЗЫКЕ СПИСКА и ПО ПОЛИТИКЕ ЕГО ТИПА (рецепт: точные
// количества; процедура: актуальность команд — см. gardener-policies).

const GARDENER_HANDLE = 'gardener'
const GARDENER_EVERY_DAYS = 2

/**
 * Ритм для живых списков. Шесть часов, а не час: материал в поток приходит по своему
 * расписанию, и чаще будить проход значит платить за refine там, где новостей ещё нет.
 * Проверка «нечего добавить» стоит один запрос и вызова модели не делает.
 */
const LIVING_EVERY_HOURS = 6
const BATCH = Number(process.env.GARDENER_BATCH ?? 3)

/** Значение LocaleText на языке списка (фолбэк en → первый непустой). */
const loc = (v: LocaleText | null | undefined, lang: Lang): string => {
  if (!v) return ''
  return v[lang] ?? v.en ?? Object.values(v).find(Boolean) ?? ''
}

/**
 * Сервисный аккаунт садовника (создаётся при первом прогоне; входа у него нет).
 *
 * Существующую строку ДОЧИНИВАЕМ: на проде садовник был создан раньше, чем появилась
 * пометка account_type, и после деплоя остался бы «человеком» — то есть ровно то, что
 * ADR-0004 запрещает. Разовым скриптом такое чинить нельзя: он забывается, а инвариант
 * должен держать код. Апдейт узкий (только пустые/дефолтные поля) и идемпотентный —
 * заданные вручную значения не перетираем.
 */
export async function ensureGardenerUser(): Promise<{ id: string }> {
  const [existing] = await db
    .select({ id: users.id, accountType: users.accountType, profession: users.profession, location: users.location })
    .from(users)
    .where(eq(users.handle, GARDENER_HANDLE))
  if (existing) {
    if (existing.accountType !== 'agent' || !existing.profession || !existing.location) {
      await db
        .update(users)
        .set({
          accountType: 'agent',
          profession: existing.profession || 'Gardener',
          location: existing.location || HOME_REALM,
        })
        .where(eq(users.id, existing.id))
      log.info('gardener user marked as service account', { id: existing.id })
    }
    return { id: existing.id }
  }
  const [created] = await db
    .insert(users)
    .values({
      handle: GARDENER_HANDLE,
      name: 'SetFork Gardener',
      // account_type='agent' (ADR-0004): служебность стала ДАННЫМИ, а не догадкой по
      // handle и эмодзи в bio — UI и API обязаны показывать, что это не человек.
      accountType: 'agent',
      profession: 'Gardener',
      location: HOME_REALM,
      bio: '\u{1F9D9} Gardener. I propose improvements to public lists; humans review and merge.',
    })
    .returning({ id: users.id })
  log.info('gardener user created', { id: created.id })
  return created
}

/**
 * Одна ОЖИДАЮЩАЯ джоба садовника в очереди — самоподдержание без cron.
 *
 * Считаем только `pending`, и это принципиально: планировщик зовётся ИЗ САМОЙ задачи, а она в
 * этот момент `processing`. Учитывая её, проверка видела бы «работа уже стоит» и преемника не
 * ставила — петля тихо умирала бы после первого прогона и оживала только рестартом инстанса
 * (нашёл ревьюер Codex на #532; проверено тестом контракта петель).
 */
export async function ensureGardenerScheduled(): Promise<void> {
  const pending = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, 'gardener'), eq(jobs.status, 'pending')))
    .limit(1)
  if (pending.length) return
  // РИТМ ЗАДАЁТ СОДЕРЖИМОЕ. Раз в двое суток — нормальный темп для полировки, но для ленты
  // это не темп: новость, добавленная через два дня, уже не новость. Пока в библиотеке есть
  // хоть один живой список, проход встаёт чаще. Отдельную петлю не заводим: рубильник,
  // журнал, предохранитель и бюджет у ухода уже есть, а второй петле их пришлось бы
  // повторить — и разъехаться с этой при первой же правке.
  const [alive] = await db.select({ id: templates.id }).from(templates).where(eq(templates.living, true)).limit(1)
  const delayMs = alive ? LIVING_EVERY_HOURS * 60 * 60 * 1000 : GARDENER_EVERY_DAYS * 24 * 60 * 60 * 1000
  // maxAttempts:1 — без ретрая всего прохода: при повторе уже авто-смёрдженные
  // кураторские списки рефайнились бы заново (двойной расход). Пропуск одного
  // прохода не страшен — следующий встаёт по расписанию.
  await enqueueJob('gardener', {}, { delayMs, maxAttempts: 1 })
  log.info('gardener scheduled', { inHours: delayMs / 3_600_000, living: !!alive })
}

/** Кандидаты: публичные активные, без открытой правки садовника, без секций
 *  (refine пока не сохраняет section) — сначала популярные и давно не обновлявшиеся. */
export async function pickCandidates(agentIds: string[], limit: number, only?: 'living' | 'ordinary') {
  // Дедуп и исключение владельца — по ВСЕМ служебным аккаунтам, а не по одному
  // садовнику: с раздачей ухода профильным специалистам автором правки может быть
  // любой из них, и проверка «уже предлагал» обязана это учитывать (иначе список
  // с открытой правкой Фьялара попадал бы в выборку снова → повторный refine).
  const agents = agentIds.length ? agentIds : ['00000000-0000-0000-0000-000000000000']
  return db
    .select({ id: templates.id, slug: templates.slug, ownerId: templates.ownerId, title: templates.title, desc: templates.desc, tags: templates.tags, currentVersion: templates.currentVersion, listKind: templates.listKind, living: templates.living, status: templates.status, ownerCurated: users.curated, ownerAccountType: users.accountType })
    .from(templates)
    .innerJoin(users, eq(users.id, templates.ownerId))
    .where(
      and(
        // Опубликованные — у любого владельца. СВОИ ЧЕРНОВИКИ — тоже: самогенерация
        // осознанно рождает черновик («публикует человек»), и без этой ветки уход
        // за собственным творчеством не начинался бы вообще — измерено на дев-БД
        // 2026-07-27: у компании 0 опубликованных списков и все её работы в черновиках.
        // Черновик чужого владельца не трогаем: это его незаконченная работа.
        or(eq(templates.status, 'published'), and(eq(templates.status, 'draft'), inArray(users.id, agents))),
        eq(templates.visibility, 'public'),
        eq(templates.moderation, 'active'),
        // Архивные/замороженные списки садовник не трогает (read-only от правок).
        sql`${templates.archivedAt} is null and ${templates.frozenAt} is null`,
        // Списки служебных аккаунтов БОЛЬШЕ НЕ исключаем: раньше стояло
        // notInArray(ownerId, agents) — «правку себе не предлагают», и следствие было
        // обратным задуманному: всё, что компания создала сама, НИКОГДА не улучшалось.
        // Теперь свои списки правятся НАПРЯМУЮ (см. ownerIsAgent ниже), без церемонии
        // «предложить себе», а чужие — предложением, как раньше.
        //
        // Зато исключаем владельцев БЕЗ ВХОДА (сид-фикстуры): проверено 2026-07-27, что
        // все 7 висевших правок были адресованы именно им — принять их некому физически,
        // и такие предложения только копят мусор. Служебные аккаунты тоже без входа,
        // поэтому условие пропускает их отдельно.
        or(
          inArray(users.id, agents),
          isNotNull(users.passwordHash),
          isNotNull(users.githubId),
          isNotNull(users.yandexId),
          isNotNull(users.telegramId),
          isNotNull(users.email),
        ),
        // Не берём список, где служебный участник уже оставил ОТКРЫТУЮ правку ЛИБО
        // что-либо предлагал за последние GARDENER_EVERY_DAYS дней. Второе условие важно
        // для кураторских списков: их правка авто-мёрджится (status='accepted', не 'open'),
        // и без учёта свежести список попадал бы в выборку снова → повторный refine.
        sql`not exists (select 1 from ${suggestions} sg where sg.template_id = ${templates.id} and sg.author_id = any(${sql.param(agents)}::uuid[])
             and (sg.status = 'open' or sg.created_at > now() - (${GARDENER_EVERY_DAYS}::int * interval '1 day')))`,
        // Ленты и обычные списки выбираем РАЗНЫМИ запросами: при общей выборке живые (они идут
        // первыми) вытесняли бы обычные из лимита, и уход выродился бы в одну ленту.
        only === 'living' ? eq(templates.living, true) : only === 'ordinary' ? eq(templates.living, false) : undefined,
      ),
    )
    // Живые списки — первыми: у ленты ценность в свежести, и ждать своей очереди за
    // популярностью она не может. Дальше как раньше: популярные и давно не обновлявшиеся.
    // Внутри лент — сначала те, кого дольше не трогали: иначе одна звёздная лента забирала бы
    // каждый проход, а соседние молчали.
    .orderBy(desc(templates.living), asc(templates.updatedAt), desc(templates.starsCount))
    .limit(limit)
}

/** Override-политики из админки (app_settings gardener.policy.<kind>); пусто = код-дефолты. */
async function policyOverrides(): Promise<Partial<Record<ListKind, string>>> {
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, POLICY_SETTING_KEYS))
  const out: Partial<Record<ListKind, string>> = {}
  for (const kind of LIST_KINDS) {
    const v = rows.find((r) => r.key === policySettingKey(kind))?.value?.trim()
    if (v) out[kind] = v
  }
  return out
}

/** Note правки — на языке списка, с честным описанием того, что делал садовник. */
function noteFor(kind: ListKind, lang: Lang): string {
  return t(kind === 'recipe' ? 'gardenerNoteRecipe' : 'gardenerNoteDefault', lang)
}



/**
 * ГЕЙТ ГОТОВНОСТИ своего черновика: публикуем без человека или оставляем с причинами.
 *
 * Почему здесь, а не отдельной петлёй: гейт имеет смысл сразу после того, как контент
 * изменился (или подтверждённо НЕ изменился — это признак, что список устоялся). Отдельная
 * петля повторяла бы выборку и расходилась бы с уходом по времени.
 *
 * Стоимость: 3 вызова модели на список, поэтому в режиме 'off' (дефолт) не тратится ничего —
 * ни линз, ни проверки ссылок.
 */
export async function gateOwnDraft(
  tpl: { id: string; slug: string; tags: string[]; desc: unknown; status: string | null; living?: boolean; freshestAgeDays?: number },
  snapshot: ReadinessInput,
  ctx: { tenderId: string; agentId: string; policyVersion: number; lang: Lang },
): Promise<'published' | 'held' | 'skipped'> {
  const settings = await getAiSettings()
  const bar: ReadinessBar = { ...DEFAULT_BAR, mode: settings.readinessMode, minSteps: settings.readinessMinSteps, minGrade: settings.readinessMinGrade }
  if (bar.mode === 'off') return 'skipped'
  // Линзы — платные: тот же per-item предохранитель, что в самогенерации.
  if (!(await globalBudgetOk())) return 'skipped'

  // Мёртвые ссылки считаем по ФИНАЛЬНОМУ содержимому: refine мог их заменить, и планка
  // должна судить то, что публикуется, а не то, что было до правки.
  const urls = snapshot.items.flatMap((it) => it.refs?.map((r) => r.url) ?? []).filter(Boolean)
  const verdictsByUrl = urls.length ? await checkUrls(urls) : new Map<string, string>()
  const deadLinks = [...verdictsByUrl.values()].filter((v) => v === 'dead').length
  // Класс полноты считаем ЗДЕСЬ же, по тем же пунктам: одна поездка по данным, один портрет
  // списка. Он и в блокеры пойдёт, и в журнал — чтобы видно было, куда список дорос.
  const verdict = gradeList(featuresOf(snapshot.items, deadLinks))
  const facts: ReadinessFacts = {
    steps: snapshot.items.length,
    deadLinks,
    hasDesc: !!snapshot.desc.trim(),
    hasTags: snapshot.tags.length > 0,
    duplicateSteps: countDuplicateSteps(snapshot.items.map((it) => it.title)),
    grade: verdict.grade,
    gradeNext: verdict.next,
    // Ленту планка судит свежестью вместо класса: класс мерит «полон ли список навсегда», а
    // лента полной не бывает. Возраст материала считает вызывающий — у него список целиком.
    living: tpl.living,
    freshestAgeDays: tpl.freshestAgeDays,
  }

  // Структурные блокеры — кодом и БЕСПЛАТНО: если список не дотягивает по ним, линзы не
  // зовём вовсе (нет смысла платить за мнение о списке из двух шагов).
  const structural = structuralBlockers(facts, bar)
  const verdicts = structural.length ? [] : await runReadinessLenses(snapshot, { userId: ctx.tenderId, refId: tpl.id })
  const decision = readinessDecision(facts, verdicts, bar)

  // КАНАРЕЙКА: даже пройденная планка не даёт публиковать больше суточной квоты. Это не
  // ошибка и не срыв предохранителя — просто дальше ждём человека.
  const quotaLeft = decision.publish ? await publishQuotaLeft('gardener', settings.readinessPerDay) : 0
  if (decision.publish && quotaLeft <= 0) {
    decision.publish = false
    decision.blockers.push(`суточная квота автопубликаций исчерпана (${settings.readinessPerDay})`)
  }

  if (decision.publish) {
    await db.update(templates).set({ status: 'published', updatedAt: new Date() }).where(eq(templates.id, tpl.id))
    // Публикация компании проходит МОДЕРАЦИЮ как любая другая: гейт готовности решает
    // «готово ли», а не «безопасно ли». Смешивать эти два вопроса нельзя.
    // Публикация компании проходит МОДЕРАЦИЮ как любая другая: гейт готовности решает
    // «готово ли», модерация — «безопасно ли показывать». Смешивать эти вопросы нельзя.
    await moderateNewPublication(tpl.id)
    await enqueueReindex(tpl.id)
  }

  await recordAgentAction({
    loop: 'gardener',
    action: decision.publish ? 'list.publish' : 'list.hold',
    resultStatus: decision.publish ? 'ok' : 'skipped',
    agentId: ctx.agentId,
    actorUserId: ctx.tenderId,
    signal: { templateId: tpl.id, slug: tpl.slug, ...facts, gradeReasons: verdict.reasons },
    decision: {
      mode: bar.mode,
      wouldPass: decision.wouldPass,
      blockers: decision.blockers,
      lenses: decision.verdicts.map((v) => `${v.lens}:${v.answer}`),
    },
    resultRef: tpl.slug,
    policyVersion: ctx.policyVersion,
  })
  log.info('gardener: readiness gate', { slug: tpl.slug, mode: bar.mode, wouldPass: decision.wouldPass, blockers: decision.blockers.length })
  return decision.publish ? 'published' : 'held'
}

/**
 * ПРАВИЛО ОСТАНОВКИ И РАСХОЖДЕНИЕ ФОРКОМ.
 *
 * Решение владельца: «нужно понимать, когда стоит остановиться в улучшении и начать делать
 * аналогии с форками, потому что бывает так, что улучшения только портят». Список, который
 * два прохода подряд не меняется, УЖЕ хорош настолько, насколько его умеет сделать машина.
 * Третий проход по нему — не улучшение, а трата денег и риск испортить.
 *
 * Что вместо: РАСХОЖДЕНИЕ. Другой профильный мастер форкает список и уводит его в другой
 * контекст — не «лучше», а ДЛЯ ДРУГОГО СЛУЧАЯ (бюджет, съёмное жильё, команда вместо
 * одиночки, другой уровень подготовки). Так растёт покрытие, а не глянец: два разных списка
 * полезнее одного отполированного.
 *
 * Счётчик берём из журнала действий — он и так пишется, отдельного состояния не надо.
 */
const STABLE_PASSES_BEFORE_FORK = 2

/** Сколько раз ПОДРЯД список признан устоявшимся (refine не нашёл, что менять). */
export async function stablePasses(templateId: string): Promise<number> {
  const rows = await db
    .select({ action: agentActions.action })
    .from(agentActions)
    .where(and(eq(agentActions.loop, 'gardener'), sql`${agentActions.signal}->>'templateId' = ${templateId}`))
    .orderBy(desc(agentActions.occurredAt))
    .limit(6)
  let n = 0
  for (const r of rows) {
    // Любое ДЕЙСТВИЕ по списку (правка, форк) обнуляет счётчик: считаем именно «подряд».
    if (r.action !== 'list.stable') break
    n++
  }
  return n
}

/** Уже расходились от этого списка? Один форк на источник — иначе плодим клоны. */
export async function alreadyForked(templateId: string, agents: string[]): Promise<boolean> {
  const [row] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.forkedFromId, templateId), inArray(templates.ownerId, agents)))
    .limit(1)
  return !!row
}

/**
 * Расхождение форком: другой мастер берёт устоявшийся список и уводит в ДРУГОЙ контекст.
 * Форк — черновик: публиковать его будет гейт готовности, как и всё остальное.
 */
async function divergeByFork(
  tpl: { id: string; slug: string; desc: LocaleText | null; tags: string[] },
  current: { title: string; desc: string; tags: string[]; items: GeneratedItem[] },
  lang: Lang,
  kind: ListKind,
  ctx: { roster: Expert[]; excludeUserId: string; agents: string[]; policyVersion: number },
): Promise<boolean> {
  // Форкает ДРУГОЙ мастер: тот же гном по тому же списку даст ту же полировку.
  const other = await tenderForTags(tpl.tags, ctx.roster.filter((e) => e.userId !== ctx.excludeUserId))
  if (!other?.userId) return false
  if (!(await globalBudgetOk())) return false

  const instruction = `${policyFor(kind, {})}
DIVERGE, do not polish. The list is already good for its original case. Produce a variant for a DIFFERENT concrete situation of the same topic (tighter budget, rented place, a team instead of one person, a different skill level, another climate or season). Change what the situation actually changes and keep the shape. Name the situation in the first item's description.`
  const variant = await generateListRefine(current, instruction, lang, { userId: other.userId, feature: 'refine', refType: 'template', refId: tpl.id, kind })
  if (!variant || !variant.items.length) return false

  const slug = await uniqueSlug(variant.title || current.title, other.userId)
  const created = await listStore.create({
    ownerId: other.userId,
    slug,
    title: { [lang]: variant.title || current.title },
    desc: variant.desc ? { [lang]: variant.desc } : (tpl.desc ?? {}),
    tags: variant.tags.length ? variant.tags.slice(0, 8) : tpl.tags,
    ordered: true,
    visibility: 'public',
    // Черновик: расхождение — гипотеза, а не улучшение. Публикует гейт готовности.
    status: 'draft',
    origin: 'forked',
    forkedFromId: tpl.id,
    note: `diverged from ${tpl.slug}`,
    steps: toStepInput(toProposed(variant.items, lang)),
  })
  await enqueueReindex(created.id)
  await recordAgentAction({
    loop: 'gardener',
    action: 'list.fork',
    resultStatus: 'ok',
    agentId: other.expert.id,
    actorUserId: other.userId,
    signal: { templateId: tpl.id, slug: tpl.slug, reason: 'stable for 2 passes - polishing further only risks harm' },
    decision: { mode: 'diverge', profession: professionOf(other.expert, 'en'), newSlug: slug },
    resultRef: slug,
    policyVersion: ctx.policyVersion,
  })
  log.info('gardener: diverged by fork', { from: tpl.slug, to: slug, by: other.expert.id })
  return true
}

/** Сколько новостей добавляем за один проход. Больше — и лента за раз меняется до неузнаваемости. */
const FEED_PER_UPDATE = 3

/**
 * Сколько пунктов держим в АКТУАЛЬНОЙ версии живого списка. Разбор ответа модели режет список
 * на 20 (`parseList`), поэтому предел нужен свой и ниже: иначе модель сама решала бы, что
 * выкинуть, ровно на границе. Вытесненное не теряется — предыдущие версии его хранят, и
 * история версий и есть «архив ленты».
 */
const FEED_MAX_ITEMS = 16

/**
 * РОСТ ЖИВОГО СПИСКА: добавить в ленту то, что пришло из потока.
 *
 * Отличие от полировки принципиальное. Обычный список улучшают: тот же материал, лучше
 * сказанный. Лента РАСТЁТ: приходит новое событие — появляется новый пункт, а старые уходят
 * вниз и в конце вытесняются в историю версий.
 *
 * Чего здесь нет намеренно:
 *   - нет вызова модели, когда потоку нечего дать. «Нет новостей» — это не «устоялся» и не
 *     повод для форка, это просто тишина: платить за неё нельзя;
 *   - нет пересказа. Промпт требует своей формулировки и практического пункта, а адрес
 *     источника уходит в `refs` пункта — сноска, а не копия. Тела статей у нас и не хранятся.
 */
export async function growLiving(
  tpl: { id: string; slug: string; tags: string[] },
  current: { title: string; desc: string; tags: string[]; items: GeneratedItem[] },
  lang: Lang,
  kind: ListKind,
  ctx: { tenderId: string; agentId: string; policyVersion: number; domains?: string[]; mode?: 'version' | 'suggestion'; ownerId?: string; baseVersion?: number },
): Promise<{ result: 'grown' | 'nothing-new' | 'failed'; snapshot?: ReadinessInput }> {
  // Ищем материал по тегам списка И по доменам мастера, который за него отвечает. Только по
  // тегам списка искать нельзя: теги списку придумала МОДЕЛЬ при создании («kubernetes», «ci»),
  // а тему подписки задавал ЧЕЛОВЕК («devops») — они законно не совпадают, и лента, которая
  // родилась из новости, больше никогда не нашла бы себе материала. Домен мастера — тот самый
  // мостик: по нему материал и достался ему в первый раз.
  const domains = [...new Set([...tpl.tags, ...(ctx.domains ?? [])])]
  const fresh = await freshForDomains(domains, FEED_PER_UPDATE)
  if (!fresh.length) return { result: 'nothing-new' }

  // События идут в ИНСТРУКЦИЮ, а она обёрнута spotlight внутри refine: заголовки чужих лент —
  // недоверенный ввод, и лента с инъекцией не должна перехватывать задачу.
  const events = fresh
    .map((f, i) => `${i + 1}. ${f.title}${f.publishedAt ? ` [${f.publishedAt.toISOString().slice(0, 10)}]` : ''} — ${f.url}${f.hint ? `\n   ${f.hint}` : ''}`)
    .join('\n')
  const instruction = `${policyFor(kind, {})}
GROW THE LIST, do not polish it. New events happened in this list's topic:
${events}

For EACH event add ONE new item at the TOP of the list:
- your OWN wording of what a person should DO about it — never a retelling or summary of the news;
- start the description with the event date if it is given;
- put the event URL into the item's refs (label = the source name).
Keep the existing items below in their current order and wording. If the list then has more than ${FEED_MAX_ITEMS} items, drop the OLDEST ones from the bottom — the version history keeps them.`

  const grown = await generateListRefine(current, instruction, lang, {
    userId: ctx.tenderId,
    feature: 'refine',
    refType: 'template',
    refId: tpl.id,
    kind,
  })
  if (!grown || !grown.items.length) return { result: 'failed' }

  // Модель могла вернуть тот же список (события проигнорированы). Тогда версии нет и материал
  // НЕ сжигаем: иначе новость исчезала бы, ни разу не появившись в ленте (находка Codex).
  const norm = (xs: GeneratedItem[]) => JSON.stringify(toProposed(xs, lang))
  if (norm(grown.items) === norm(current.items)) {
    log.info('gardener: living list unchanged, material kept', { slug: tpl.slug })
    return { result: 'failed' }
  }

  const items = toProposed(grown.items.slice(0, FEED_MAX_ITEMS), lang)
  if (ctx.mode === 'suggestion') {
    // Чужой живой список растёт ПРЕДЛОЖЕНИЕМ: свежесть ему нужна так же, как своему, но писать
    // в список человека от своего имени нельзя. Обе находки ревью держатся вместе только так.
    const [created] = await db
      .insert(suggestions)
      .values({
        templateId: tpl.id,
        authorId: ctx.tenderId,
        note: noteFor(kind, lang),
        baseVersion: ctx.baseVersion ?? 1,
        items,
        number: sql`(select coalesce(max(number), 0) + 1 from suggestions where template_id = ${tpl.id})`,
      })
      .returning({ id: suggestions.id })
    await notify({ recipientId: ctx.ownerId ?? '', actorId: ctx.tenderId, type: 'suggestion_new', templateId: tpl.id, suggestionId: created.id })
  } else {
    await listStore.addVersion(tpl.id, { note: noteFor(kind, lang), steps: toStepInput(items), authorId: ctx.tenderId })
    await notifyMany(await getWatcherIds(tpl.id, 'versions'), { actorId: ctx.tenderId, type: 'new_version', templateId: tpl.id })
    await enqueueReindex(tpl.id)
  }
  // Материал списываем ПОСЛЕ версии: упади запись — новости остались бы «использованными»
  // без списка, и повод пропал бы навсегда.
  //
  // И списываем ТОЛЬКО то, что реально попало в результат. Проверки «список не изменился»
  // недостаточно: модель могла добавить два события из трёх, а помечались все — третье
  // исчезало навсегда, ни разу не появившись в ленте. Ищем адрес события в готовых
  // пунктах: промпт требует класть его в refs, значит адрес — честный признак того,
  // что событие обработано. Не нашли ни одного (модель переписала ссылки) — списываем
  // всё, как раньше: иначе одни и те же новости крутились бы вечно.
  const produced = JSON.stringify(items).toLowerCase()
  const landed = fresh.filter((f) => produced.includes(f.url.toLowerCase()))
  await markUsed((landed.length ? landed : fresh).map((f) => f.id), tpl.id)
  if (landed.length && landed.length < fresh.length) {
    log.info('gardener: часть событий не вошла в ленту — остаются для следующего прохода', {
      slug: tpl.slug,
      landed: landed.length,
      kept: fresh.length - landed.length,
    })
  }
  await recordAgentAction({
    loop: 'gardener',
    action: 'list.grow',
    resultStatus: 'ok',
    agentId: ctx.agentId,
    actorUserId: ctx.tenderId,
    signal: { templateId: tpl.id, slug: tpl.slug, events: fresh.length },
    decision: { mode: ctx.mode === 'suggestion' ? 'grow-feed-suggestion' : 'grow-feed', sources: fresh.map((f) => f.url).slice(0, FEED_PER_UPDATE) },
    resultRef: tpl.slug,
    policyVersion: ctx.policyVersion,
  })
  log.info('gardener: living list grown', { slug: tpl.slug, events: fresh.length })
  return {
    result: 'grown',
    snapshot: { title: grown.title || current.title, desc: grown.desc || current.desc, tags: grown.tags.length ? grown.tags : current.tags, items: grown.items.slice(0, FEED_MAX_ITEMS) },
  }
}

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
  for (const tpl of candidates) {
    const [ver] = await db
      .select({ id: templateVersions.id })
      .from(templateVersions)
      .where(and(eq(templateVersions.templateId, tpl.id), eq(templateVersions.version, tpl.currentVersion)))
    const rows = ver
      ? await db.select().from(steps).where(eq(steps.versionId, ver.id)).orderBy(asc(steps.n))
      : []

    // Язык списка — по его контенту (раньше RU-список рефайнился на английском
    // и садовник предлагал перевод вместо улучшения).
    const lang = dominantLang([tpl.title, tpl.desc, ...rows.map((s) => s.title)])
    // Тип списка: колонка → структурная эвристика → грамматика заголовка;
    // определённое лениво дозаписываем (самозаполняющийся бэкфилл).
    const kind: ListKind = (LIST_KINDS as readonly string[]).includes(tpl.listKind ?? '')
      ? (tpl.listKind as ListKind)
      : inferListKind({
          title: loc(tpl.title, lang),
          sections: rows.map((s) => loc(s.section, lang)).filter(Boolean),
          commandCount: rows.filter((s) => s.command.trim()).length,
        })
    if (!tpl.listKind) await db.update(templates).set({ listKind: kind }).where(eq(templates.id, tpl.id))

    const current = {
      title: loc(tpl.title, lang),
      desc: loc(tpl.desc, lang),
      tags: tpl.tags,
      items: rows.map((s) => ({
        title: loc(s.title, lang),
        desc: loc(s.desc, lang),
        command: s.command,
        section: loc(s.section, lang),
        level: s.level,
        why: loc(s.why, lang),
        // Пометки «здесь нужен человек» ОБЯЗАНЫ входить в снимок: refine получает список
        // JSON'ом и возвращает его целиком, поэтому поле, которого в снимке нет, исчезает
        // из результата — то есть каждый проход ухода СТИРАЛ бы честные пометки.
        needsHuman: s.needsHuman,
        needsHumanAsk: loc(s.needsHumanAsk, lang),
        subtasks: (s.subtasks ?? []).map((x) => loc(x, lang)).filter(Boolean),
        refs: (s.refs ?? []).map((r) => ({ label: loc(r.label, lang), url: r.url ?? '' })),
      })),
    }

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
    const gateCtx = { tenderId, agentId: tender?.expert.id ?? '', policyVersion: loop.policyVersion, lang }

    // СУХОЙ ПРОГОН: кого выбрали и что нашли — в журнал, refine НЕ зовём (он платный).
    // Проверка стоит до вызова модели и после выбора мастера, чтобы в журнале было
    // видно настоящее решение петли, а не заготовку.
    if (loop.dryRun) {
      await recordAgentAction({
        loop: 'gardener',
        action: ownedByCompany ? 'list.improve' : 'list.suggest',
        resultStatus: 'dry-run',
        agentId: tender?.expert.id ?? '',
        actorUserId: tenderId,
        signal: { trigger: 'schedule', slug: tpl.slug, deadLinks: deadUrls.length },
        decision: { mode: ownedByCompany ? 'direct-edit' : 'suggestion', profession: tender ? professionOf(tender.expert, 'en') : 'generic' },
        policyVersion: loop.policyVersion,
      })
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
          await recordAgentAction({
            loop: 'gardener',
            action: 'list.fresh-none',
            resultStatus: 'skipped',
            agentId: tender?.expert.id ?? '',
            actorUserId: tenderId,
            signal: { templateId: tpl.id, slug: tpl.slug },
            decision: { reason: 'living list: the stream had nothing new' },
            resultRef: tpl.slug,
            policyVersion: loop.policyVersion,
          })
        }
        skipped++
      }
      continue
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
      await recordAgentAction({
        loop: 'gardener',
        action: 'list.stable',
        resultStatus: 'skipped',
        agentId: tender?.expert.id ?? '',
        actorUserId: tenderId,
        signal: { templateId: tpl.id, slug: tpl.slug },
        decision: { reason: 'refine returned the same content' },
        resultRef: tpl.slug,
        policyVersion: loop.policyVersion,
      })
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
      await recordAgentAction({
        loop: 'gardener',
        action: 'list.suggest',
        resultStatus: 'ok',
        agentId: tender?.expert.id ?? '',
        actorUserId: tenderId,
        signal: { trigger: 'schedule', slug: tpl.slug, deadLinks: deadUrls.length },
        decision: { mode: 'suggestion', reason: 'recipe — правку количеств смотрит человек' },
        resultRef: tpl.slug,
        policyVersion: loop.policyVersion,
      })
      proposed++
      log.info('gardener: recipe suggestion opened on own list', { slug: tpl.slug, suggestionId: rec.id })
      continue
    }

    if (ownedByCompany) {
      await listStore.addVersion(tpl.id, { note: note, steps: toStepInput(items), authorId: tenderId })
      await notifyMany(await getWatcherIds(tpl.id, 'versions'), { actorId: tenderId, type: 'new_version', templateId: tpl.id })
      await enqueueReindex(tpl.id)
      await recordAgentAction({
        loop: 'gardener',
        action: 'list.improve',
        resultStatus: 'ok',
        agentId: tender?.expert.id ?? '',
        actorUserId: tenderId,
        signal: { trigger: 'schedule', slug: tpl.slug, deadLinks: deadUrls.length },
        decision: { mode: 'direct-edit', reason: 'company-owned list — no receiver for a suggestion' },
        resultRef: tpl.slug,
        policyVersion: loop.policyVersion,
      })
      proposed++
      log.info('gardener: own list improved directly', { slug: tpl.slug, tender: tender?.expert.id ?? 'generic' })
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
      await listStore.addVersion(tpl.id, { note: '\u{1F9D9} gardener: refreshed steps', steps: toStepInput(items), authorId: tenderId })
      await db.update(suggestions).set({ status: 'accepted', resolvedAt: new Date() }).where(eq(suggestions.id, created.id))
      await notifyMany(await getWatcherIds(tpl.id, 'versions'), { actorId: tenderId, type: 'new_version', templateId: tpl.id })
      await enqueueReindex(tpl.id)
      log.info('gardener: auto-merged on curated list', { slug: tpl.slug })
    } else {
      await notify({ recipientId: tpl.ownerId, actorId: tenderId, type: 'suggestion_new', templateId: tpl.id, suggestionId: created.id })
      log.info('gardener: suggestion opened', { slug: tpl.slug, suggestionId: created.id, tender: tender?.expert.id ?? 'generic' })
    }
    proposed++
  }
  log.info('gardener sweep done', { candidates: candidates.length, proposed, skipped, published, diverged })
  return { proposed, skipped, published, diverged }
}
