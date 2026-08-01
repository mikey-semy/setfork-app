import 'server-only'
import { and, eq, gte, sql } from 'drizzle-orm'
import type { Lang } from '@/shared/i18n'
import { aiUsage, db, generationCandidates, generationDrafts, generationMessages, generations, users, type CandidateItem } from '@/shared/db'
import { generateChangeNote, generateListDraft, sanitizeCommand, type GenerateOptions, type GeneratedList } from '@/shared/ai/generate'
import { serializeFailure, type AiFailure } from '@/shared/ai/failure'
import { backfillRecipeSections } from '@/shared/ai/list-kind'
import { toDetail } from '@/shared/ai/detail-level'
import { generateListCouncil, type CouncilDraft, type CouncilProvenance } from '@/shared/ai/council'
import { setClarify } from '@/shared/ai/council-clarify'
import { pushMessage, setGenerationStatus } from '@/shared/ai/generation-messages'
import { recordUsage } from '@/shared/ai/usage'
import { getAiSettings } from '@/shared/settings/ai'
import { log } from '@/shared/observability'
import { isPro } from '@/shared/entitlements'
import { parseTags } from '@/features/library/slug'

/**
 * Тариф пользователя — для гейта аудитории совета.
 *
 * Спрашиваем `isPro`, а не «админ ли он». Разница нулевая СЕГОДНЯ (planFor: админ →
 * pro) и решающая завтра: когда появится оплата, `planFor` начнёт читать подписку из
 * БД — и совет пойдёт платящим сам собой. Прежняя проверка админа осталась бы на
 * месте, и купивший Pro совета бы не получил, хотя в описании тарифа он значится.
 */
async function isProUser(userId: string): Promise<boolean> {
  try {
    const [u] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1)
    return isPro(u?.handle ?? null)
  } catch {
    return false
  }
}

// Лимит совета считаем по ДОСТАВЛЕННЫМ советам за месяц (маркер 'council-run'), а не по попыткам:
// clarify/фолбэк/ошибка слот не жгут. Маркер пишется только при реально отданном списке.
async function councilRunsThisMonth(userId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(distinct ${aiUsage.refId})::int` })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.refType, 'council-run'), gte(aiUsage.createdAt, sql`date_trunc('month', now())`)))
  return r?.n ?? 0
}
function recordCouncilRun(userId: string, generationId: string): Promise<void> {
  return recordUsage({ userId, feature: 'generate', model: 'council', input: 0, output: 0, total: 0, cost: 0, refType: 'council-run', refId: generationId })
}

/**
 * «Что поменялось ключевое» относительно ПРЕДЫДУЩЕГО варианта — одной строкой, для ленты.
 * Переиспользуем generateChangeNote: она ровно про это (примечание к версии из диффа, как
 * git-commit message) — своя функция была бы дублем. Пусто при любой осечке: подпись
 * необязательна, вариант важнее.
 */
async function describeChange(
  generationId: string,
  idx: number,
  items: CandidateItem[],
  lang: Lang,
  opts: GenerateOptions,
): Promise<string> {
  try {
    const [prev] = await db
      .select({ items: generationCandidates.items })
      .from(generationCandidates)
      .where(and(eq(generationCandidates.generationId, generationId), eq(generationCandidates.idx, idx - 1)))
      .limit(1)
    if (!prev) return ''
    return (await generateChangeNote(prev.items, items, lang, { ...opts, feature: 'note' })) ?? ''
  } catch {
    return ''
  }
}

/**
 * Сгенерировать один вариант и сохранить кандидатом (idx). Возвращает false при ошибке ИИ.
 * Вынесено из actions.ts, чтобы вызывать из фонового воркера очереди (job 'generate').
 */
export async function addCandidate(
  generationId: string,
  userId: string,
  query: string,
  lang: Lang,
  idx: number,
  /** Последняя ли это попытка очереди по задаче. Только на ней провал объявляется человеку.
   *  Дефолт true — прямой вызов (не из воркера) означает, что повторять некому. */
  opts?: { final?: boolean },
): Promise<boolean> {
  // ИДЕМПОТЕНТНОСТЬ ПО РАСХОДУ. Задача 'generate' ставится с maxAttempts: 2, плюс её
  // переподхватывает reapStalledJobs — то есть повтор штатный. А самая дорогая часть
  // (совет ≈ 6.5 вызовов моделей) шла ДО вставки кандидата, поэтому «упало после дорогой
  // части» и «процесс умер на деплое» оплачивались второй раз: уникальность
  // (generation_id, idx) защищала данные, но не деньги (линза 03, №5). Готовый кандидат
  // с этим idx означает, что работа уже сделана и оплачена — второй раз не платим.
  const [done] = await db
    .select({ idx: generationCandidates.idx })
    .from(generationCandidates)
    .where(and(eq(generationCandidates.generationId, generationId), eq(generationCandidates.idx, idx)))
    .limit(1)
  if (done) {
    await setGenerationStatus(generationId, 'done')
    return true
  }

  // Ленту больше НЕ чистим: реплики группируются по витку (attempt = idx), поэтому прошлые прогоны
  // не мешаются — а история придумывания остаётся навсегда, в этом весь смысл беседы.
  await setGenerationStatus(generationId, 'pending')

  // settings читаем ПЕРВЫМ: от него зависит genOpts.web, обращаться к нему до объявления нельзя (TDZ).
  const settings = await getAiSettings()
  // Тип и объём — из строки generations (выбор пользователя переживает «ещё вариант»:
  // перечитываем их здесь, а не тащим в payload задачи).
  const [genRow] = await db
    .select({ listKind: generations.listKind, detail: generations.detail })
    .from(generations)
    .where(eq(generations.id, generationId))
    .limit(1)
  // Причину провала кладём в держатель, а не в let: пишется она из колбэка (глубина модели),
  // а читается в finally — на обычной переменной анализатор типов увидел бы вечный null.
  const failure: { reason: AiFailure | null } = { reason: null }
  const genOpts: GenerateOptions = {
    // Веб-поиск — по настройке, НЕ всегда: `:online` берёт флэт-фи ~$0.005/вызов (было 60% расхода,
    // включённое втихую на каждой генерации). Совет управляет вебом своим councilWebSeek отдельно.
    web: settings.webSearch,
    variant: idx,
    kind: (genRow?.listKind as GenerateOptions['kind']) ?? undefined,
    detail: toDetail(genRow?.detail),
    userId,
    feature: idx > 1 ? 'regenerate' : 'generate',
    refType: 'generation',
    refId: generationId,
    onFail: (f) => {
      failure.reason = f
    },
  }

  // Терминальный статус ГАРАНТИРОВАН через finally: любой throw ниже (insert, ошибка модели, TypeError)
  // раньше оставлял генерацию в 'pending' НАВСЕГДА, а чат поллит только пока pending → вечный спиннер.
  let delivered = false
  let clarified = false
  try {
    // «Совет» (за флагом + гейт аудитории). Дорогие проверки (тариф/лимит) — ТОЛЬКО когда фича включена.
    let useCouncil = false
    if (settings.councilEnabled) {
      const pro = await isProUser(userId)
      useCouncil = settings.councilAudience === 'all' || pro
      // Лимит (не для Pro): по ДОСТАВЛЕННЫМ советам за месяц; исчерпал → одиночная генерация.
      if (useCouncil && !pro && settings.councilMaxPerMonth > 0 && (await councilRunsThisMonth(userId)) >= settings.councilMaxPerMonth) {
        useCouncil = false
      }
    }

    let draft: (GeneratedList & { provenance?: CouncilProvenance; drafts?: CouncilDraft[] }) | null = null
    if (useCouncil) {
      // #6: под-вызовы совета помечаем refType 'council' — админ-«Расход» отличает их от одиночных.
      const res = await generateListCouncil(query, lang, { ...genOpts, refType: 'council' })
      if (res && 'clarify' in res) {
        // Диалог только на ПЕРВИЧНОЙ генерации: показываем форму (кандидата нет, ждём ответов).
        // На «ещё вариант» (idx>1) clarify игнорируем — иначе пустой экран/коллизия idx=1; падаем на одиночную.
        if (idx === 1) {
          await setClarify(generationId, res.clarify)
          await setGenerationStatus(generationId, 'clarify')
          clarified = true
          return true
        }
      } else {
        draft = res
      }
      // #4: слот лимита дебетуем ТОЛЬКО при реально отданном списке (не clarify/фолбэк/ошибка).
      if (draft) await recordCouncilRun(userId, generationId)
    }
    draft = draft ?? (await generateListDraft(query, lang, genOpts))
    if (!draft) return false // finally проставит 'failed' + реплику ошибки

    const items: CandidateItem[] = draft.items.map((it) => ({
      title: it.title,
      desc: it.desc,
      command: sanitizeCommand(it.command ?? ''),
      section: it.section,
      level: it.level,
      why: it.why,
      subtasks: it.subtasks,
      refs: it.refs,
      // Пометка «здесь нужен человек» — часть кандидата: иначе честное признание модели
      // («местную цену я знать не могу») теряется на пути кандидат → принятый список.
      ...(it.needsHuman ? { needsHuman: true, needsHumanAsk: it.needsHumanAsk ?? '' } : {}),
    }))
    // Рецепт: если модель не проставила секции (gpt-4o-mini часто не проставляет) — выводим их
    // структурно, чтобы карточка разделила «Ингредиенты»/«Приготовление», а не рисовала всё в кучу.
    if (genOpts.kind === 'recipe') backfillRecipeSections(items, lang === 'ru')
    // Здоровье ссылок (HQ §9): уверенно мёртвые refs (404/410) выкидываем ДО сохранения,
    // критик отчитывается в ленту. Сбой проверки не роняет генерацию.
    try {
      const { filterDeadRefs } = await import('@/shared/lib/link-health')
      const dead = await filterDeadRefs(items)
      if (dead > 0) {
        const sayL = (en: string, ru: string) => (lang === 'ru' ? ru : en) // строки-аргументами (i18n-lint)
        await pushMessage(generationId, {
          attempt: idx,
          kind: 'critique',
          text: sayL(`Checked the links — removed dead ones: ${dead}`, `Проверил ссылки — выкинул мёртвых: ${dead}`),
          who: 'critic',
          name: sayL('Critic', 'Критик'),
        })
      }
    } catch {
      // сеть/таймауты проверки — не повод терять вариант
    }
    // «Что поменялось ключевое» — только со 2-го витка: у первого сравнивать не с чем.
    const summary = idx > 1 ? await describeChange(generationId, idx, items, lang, genOpts) : ''
    // onConflictDoUpdate по (generationId, idx): ретрай джобы или гонка двух «дополнить» на один idx
    // не роняют insert по UNIQUE (это тоже вело в вечный pending) — переписываем свой виток.
    const title = (draft.title || query).slice(0, 140)
    // Провенанс (объяснимость, HQ §6) пишется В МОМЕНТ витка — потом не восстановить.
    // Пустой объект у одиночной генерации (у неё пока нет провенанса) — не null, чтобы
    // читателю не различать «нет колонки/нет данных».
    const provenance = (draft.provenance ?? {}) as Record<string, unknown>
    const hint = draft.hint ?? ''
    await db
      .insert(generationCandidates)
      .values({
        generationId,
        idx,
        title,
        desc: draft.desc ?? '',
        summary,
        tags: draft.tags.length ? parseTags(draft.tags.join(' ')) : parseTags(query),
        items,
        provenance,
        hint,
      })
      .onConflictDoUpdate({
        target: [generationCandidates.generationId, generationCandidates.idx],
        set: { title, desc: draft.desc ?? '', summary, items, provenance, hint },
      })
    // ЧЕРНОВИКИ СОВЕТА — на диск. Без них многогранность («сколько своих граней принёс
    // каждый и сколько потерял синтез») замерить нечем: раньше они выбрасывались вместе с
    // памятью вызова. Пишем ПОСЛЕ кандидата: FK на generation, порядок вставки безразличен,
    // но так неудачная запись замера не мешает доставке результата человеку.
    if (draft.drafts?.length) {
      try {
        // ЗАМЕНА, а не досыпка. Обычная вставка задваивала строки при каждом повторе
        // попытки: воркер перезапустил задачу (reap/retry) или две задачи разошлись на
        // одном (generationId, idx) — и к прежнему набору A/B/C добавлялся ещё один.
        // Замер многогранности группирует строки одного витка и считает КАЖДУЮ, поэтому
        // дубли завышали вклад и приписывали его не тем граням: цифра врала молча.
        //
        // Транзакцией: между удалением и вставкой не должно существовать состояния
        // «черновиков нет», иначе параллельный замер прочитал бы пустой виток.
        await db.transaction(async (tx) => {
          await tx.delete(generationDrafts).where(and(eq(generationDrafts.generationId, generationId), eq(generationDrafts.idx, idx)))
          await tx.insert(generationDrafts).values(
            draft.drafts!.map((d) => ({ generationId, idx, letter: d.letter, who: d.who, text: d.text.slice(0, 20_000) })),
          )
        })
      } catch (e) {
        log.warn?.('generation drafts not saved', { generationId, err: e instanceof Error ? e.message : String(e) })
      }
    }
    delivered = true
    await setGenerationStatus(generationId, 'done')
    return true
  } catch (e) {
    // Упало У НАС уже после модели (вставка кандидата, TypeError): своя причина не менее
    // важна, чем причина модели, — иначе «Подробности» в чате остались бы пустыми.
    // Ошибку не глотаем: воркер по ней решает про ретрай.
    failure.reason = failure.reason ?? { code: 'internal', detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }
    throw e
  } finally {
    // Не успех и не уточнение → честный 'failed' + одна реплика ошибки. Гарантия против вечного спиннера.
    // В текст реплики кладём причину кодом (shared/ai/failure): чат держит её свёрнутой,
    // но человек может открыть и переслать нам — раньше она умирала в логах воркера.
    //
    // ТОЛЬКО НА ПОСЛЕДНЕЙ ПОПЫТКЕ. Пока в очереди лежит автоматический повтор, работа не
    // закончена: объявив провал раньше, экран показывал бы кнопку «Ещё раз» параллельно
    // живой задаче — нажатие поставило бы ВТОРУЮ генерацию, и обе жгли бы модели и клали
    // по кандидату на один запрос. До повтора статус остаётся 'pending': человек видит,
    // что совет ещё работает, — так оно и есть.
    if (!delivered && !clarified && (opts?.final ?? true)) {
      await setGenerationStatus(generationId, 'failed')
      await pushMessage(generationId, { attempt: idx, kind: 'error', text: serializeFailure(failure.reason), who: 'council' })
    }
  }
}

/**
 * Задачу похоронила очередь, а её виток ничего не сказал: процесс умер (деплой, OOM) до
 * `finally` выше. Генерация осталась в 'pending' — экран поллит вечно и показывает работу
 * совета, которой давно нет. Здесь мы её закрываем, чтобы человек увидел причину и кнопку.
 *
 * «Статус pending» САМ ПО СЕБЕ ничего не доказывает — за ним стоят три разных положения дел,
 * и валить их в одно значит врать человеку (находка авто-ревью по #637):
 *
 *  1. Кандидат с этим idx УЖЕ ЛЕЖИТ в базе — процесс умер между вставкой варианта и
 *     'done'. Вариант доставлен и оплачен: закрываем в 'done'. Объявить провал при готовом
 *     списке на экране — худшее, что тут можно сделать.
 *  2. Виток этой задачи — не последний: человек уже запустил следующий, и 'pending'
 *     принадлежит ЕМУ. Трогать нельзя: иначе экран объявит провал живой задаче и покажет
 *     «Ещё раз» — ровно та гонка двух генераций, которую чинили в #634.
 *  3. Ни того, ни другого — виток действительно брошен: 'failed' + причина 'lost'.
 *
 * Все проверки — В САМОМ UPDATE (подзапросами), а не чтением до записи: между чтением и
 * записью виток может доехать сам, и мы затрём его результат.
 */
export async function abandonGeneration(generationId: string, idx: number): Promise<void> {
  // (1) Вариант всё-таки доставлен — это успех, а не потеря.
  const delivered = await db.execute(sql`
    UPDATE ${generations} SET status = 'done', updated_at = now()
    WHERE id = ${generationId} AND status = 'pending'
      AND EXISTS (SELECT 1 FROM ${generationCandidates} WHERE generation_id = ${generationId} AND idx = ${idx})
    RETURNING id
  `)
  if ((delivered as { rows?: unknown[] }).rows?.length) {
    log.warn?.('generation closed as done: job died after the candidate was saved', { generationId, idx })
    return
  }

  // (2)+(3) Хороним, только если этот виток — последний в нити: более поздняя реплика или
  // кандидат означают, что 'pending' уже не наш.
  const closed = await db.execute(sql`
    UPDATE ${generations} SET status = 'failed', updated_at = now()
    WHERE id = ${generationId} AND status = 'pending'
      AND coalesce((SELECT max(attempt) FROM ${generationMessages} WHERE generation_id = ${generationId}), 0) <= ${idx}
      AND coalesce((SELECT max(idx) FROM ${generationCandidates} WHERE generation_id = ${generationId}), 0) <= ${idx}
    RETURNING id
  `)
  if (!(closed as { rows?: unknown[] }).rows?.length) return
  await pushMessage(generationId, { attempt: idx, kind: 'error', text: serializeFailure({ code: 'lost' }), who: 'council' })
  log.warn?.('generation abandoned: job died before reporting', { generationId, idx })
}
