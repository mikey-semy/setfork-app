import 'server-only'
import { getAiSettings } from '@/shared/settings/ai'
import { globalBudgetOk } from '@/shared/quota'
import { getAiChatClient } from '../provider'
import { pickChatModel } from '../credits'
import { type AiFeature } from '../usage'
import { spotlight, type Spotlight } from '../spotlight'
import { parseList, jsonShapeFor, type GeneratedList, type GenerateOptions } from '../generate'
import { shapeFor } from '../list-kind'
import { getRoster, type Expert } from '../roster'
import { pickPrecedents, pickPrecedentsDetailed } from '../precedent-filter'
import { pruneDrafts } from '../prune'
import { craftRules } from '../triples'
import { lawBlock } from '../list-laws'
import { pushMessage, type GenMessageKind } from '../generation-messages'
import { t, langEnName, type Lang } from '@/shared/i18n'
import { anonymizeDrafts, clip, draftLetter } from './text'
import { resolveCouncilPool } from './pool'
import { firstJson, makeCouncilRunner, online } from './call'
import { startCouncilVoices } from './voices'
import { askClarify } from './clarify'
import { askSteward } from './steward'
import { summonExperts } from './experts'
import { gatherGrounding } from './grounding'
import type { CouncilProvenance, CouncilResult } from './types'

/**
 * «Совет гномов» — мультимодельная генерация списка (research 2026-07-13):
 *   распорядитель (глубина+созыв) → эксперты ∥ + новатор (дивергенция) → адвокат дьявола → старейшина-синтез.
 * Drop-in к generateListDraft: возвращает тот же GeneratedList. Каждый под-вызов пишется в aiUsage
 * (refType 'council'), уважает globalBudgetOk. Гейт — settings.councilEnabled (OFF по умолчанию).
 *
 * НЕ в этом инкременте (следующие): стрим беседы/UI, Pro-гейт, RAG-старейшина по нашим спискам
 * (pgvector), диалог/уточняющие вопросы, память сессии.
 */

const INNOVATOR_TEMP = 0.9

/** Мультимодельный «совет гномов». null при ошибке/выкл — caller фолбэкает на generateListDraft. */
export async function generateListCouncil(query: string, lang: Lang, opts: GenerateOptions = {}): Promise<CouncilResult> {
  const client = await getAiChatClient()
  if (!client) return null
  // Из клиента вызову нужны ровно две вещи — чем звать и чей это провайдер (см. call.ts).
  const chat = client.chat
  const providerId = client.cfg.provider
  const settings = await getAiSettings()
  if (!settings.enabled) return null
  if (!(await globalBudgetOk())) return null
  const langName = langEnName(lang)
  const base = await pickChatModel(settings) // конфигурируемая модель — для ФИНАЛЬНОГО списка (качество)
  // Модели совета: пул, быстрая модель для промежуточных шагов и проверка «этой
  // моделью можно» — всё в council/pool.ts (провайдер, каталог, белый список, карантин).
  // Ростер — из БД (админка); пустая таблица → сид исходным составом, ошибка → SEED.
  // Друг от друга они не зависят, поэтому идут одновременно: оба ходят наружу (каталог
  // моделей и БД), и последовательные await складывали их задержки без всякой причины.
  const [{ pool, fast, usable }, EXPERTS] = await Promise.all([resolveCouncilPool(client.cfg.provider, settings, base), getRoster()])
  const maxGnomes = Math.max(1, Math.min(settings.councilMaxGnomes || 3, EXPERTS.length))
  // :online-суффикс — механика OpenRouter; на других провайдерах веб-шагов нет.
  const isOpenRouter = client.cfg.provider === 'openrouter'
  const web = (opts.web ?? true) && isOpenRouter
  const sp: Spotlight = spotlight()
  const topic = sp.wrap('TOPIC', query)
  // Закон типа списка (напр. рецепт) — по ЗАПРОСУ, а не по составу совета: на простой теме
  // распорядитель идёт одиночной генерацией и повара не зовёт, а форма всё равно обязана держаться.
  const law = lawBlock(query)
  const feature: AiFeature = opts.feature ?? 'generate'
  const ru = lang === 'ru'
  // Подпись говорящего в беседе (идентичность роли несёт аватарка, поэтому эмодзи в ростере больше нет).
  const gtitle = (e: Expert) => (ru ? e.nameRu : e.nameEn)
  // Беседа: пишем ход совета в БД (по refId=generationId). Виток = variant (idx кандидата) —
  // реплики разных попыток не мешаются, а группируются, поэтому ленту больше не надо стирать.
  // fire-and-forget: запись реплики не должна блокировать/ронять генерацию.
  const attempt = opts.variant ?? 1
  const emit = (kind: GenMessageKind, text: string, who?: string, name?: string) => {
    if (opts.refId) void pushMessage(opts.refId, { attempt, kind, text, who, name }).catch(() => {})
  }

  // Единственная точка вызова модели: таймаут, ретрай транзиента, учёт расхода — в call.ts.
  const run = makeCouncilRunner({ chat, providerId, feature, maxTokens: settings.maxTokens, temperature: settings.temperature, opts })

  // Голоса гномов: шлифовка стартует ДО первого этапа и не блокирует его (voices.ts).
  const vl = startCouncilVoices({ run, fast, experts: EXPERTS, lang, langName, topic, seed: `${opts.refId ?? query}:${attempt}`, spotlightRule: sp.rule() })

  // 0) Ворота беседы: спросить ли уточнения, прежде чем собирать совет (clarify.ts).
  const clarifyQuestions = await askClarify({ run, fast, query, topic, lang, langName, spotlightRule: sp.rule(), enabled: settings.councilClarify, attempt })
  if (clarifyQuestions.length) {
    emit('plan', vl('reporter', 'clarify') ?? t('ai.theRequestBroadCouple', lang), 'reporter', t('common.reporter', lang))
    return { clarify: clarifyQuestions }
  }

  // 1) Распорядитель: глубина, тип списка и созыв по домену (адаптивная глубина = лимит цены).
  const { depth, kind, summoned } = await askSteward({ run, fast, query, topic, experts: EXPERTS, maxGnomes, forcedKind: opts.kind, spotlightRule: sp.rule() })

  // law — обязательная форма типа списка (напр. рецепт). Раньше её тут НЕ было, и получался парадокс:
  // совет ВЫКЛ → рецепт правильный (generate.ts закон применяет), совет ВКЛ + «тема простая» → сломан.
  // Закон отсутствовал ровно в single-ветке совета, ради которой он и писался.
  // Форма по типу списка (kind): та же структура JSON, иной смысл элемента (ADR-0010).
  const listRules = `You produce a canonical, high-quality reference list. All content MUST be in ${langName}.${law}\n${jsonShapeFor(kind)}\n${sp.rule()}`

  // Тривиально → один гном (обычная генерация, но через тот же учёт совета).
  if (depth === 'single') {
    emit('plan', vl('planner', 'plan-single') ?? t('ai.simpleTopicWritingUp', lang), 'planner', t('ai.planner', lang))
    const one = await run(online(base, web), listRules, `Create the reference list for the topic below.\n${topic}`)
    const single = one ? parseList(firstJson(one.text), query) : null
    return single
      ? { ...single, provenance: { engine: 'council', depth: 'single', provider: providerId, kind, precedents: [], models: { single: base } } }
      : null
  }
  emit('plan', vl('planner', 'plan-council') ?? t('ai.theTopicManySided', lang), 'planner', t('ai.planner', lang))

  // 2) Созыв: названные распорядителем, по репутации, с добором до пола разнообразия (experts.ts).
  const experts = await summonExperts({ roster: EXPERTS, summoned, maxGnomes })
  const names = experts.map(gtitle).join(', ')
  emit('summon', vl('crier', 'summon', { names }) ?? t('ai.consultingNames', lang).replace('{names}', names), 'crier', t('ai.coordinator', lang))

  // 2.5) Опора витка: прецеденты из наших списков, ремесленные правила, веб (grounding.ts).
  const grounding = await gatherGrounding({
    run, fast, query, topic, lang, langName, sp,
    domains: experts.flatMap((e) => e.domains),
    userId: opts.userId,
    webSeekEnabled: settings.councilWebSeek,
    isOpenRouter,
    announce: {
      lists: (n) => emit('seek', vl('seek-lists', 'seek', { n: String(n) }) ?? t('ai.similarListsN', lang).replace('{n}', String(n)), 'seek-lists', t('ai.librarian', lang)),
      web: () => emit('seek', vl('seek-web', 'seek') ?? t('ai.searchingWebPrecedents', lang), 'seek-web', t('ai.webScout', lang)),
    },
  })
  const { precedents, stepPrecedents, rules, rulesBlock, loreBlock, stepsBlock, webLore } = grounding

  // Бюджет проверяем и ВНУТРИ витка, а не только на входе: совет — это ~6-7 вызовов
  // моделей, и между стартом и фан-аутом черновиков денег может уже не быть (линза 03,
  // №3). Фан-аут — самая дорогая стадия (N моделей разом), поэтому перед ней стоп:
  // ничего не начато, тратить нечего, caller фолбэкнет на одиночную генерацию (она
  // спросит бюджет сама). Стадии ПОСЛЕ оплаченных черновиков не отменяем — иначе
  // деньги уже потрачены, а результата нет; там бюджет режет необязательное (см. ниже).
  if (!(await globalBudgetOk())) return null

  // 3) Эксперты набрасывают НЕЗАВИСИМО ∥ (получая прецеденты) + гном-новатор (дивергенция, temp↑, БЕЗ прецедентов — чтобы расходился).
  const expertProv: NonNullable<CouncilProvenance['experts']> = []
  // Пробелы опоры собираем ПО ХОДУ витка: потом эти данные не восстановить.
  const noBasis: string[] = []
  if (!precedents.length) noBasis.push('в библиотеке не нашлось ни одного прецедента по теме')
  if (!rules.length) noBasis.push('база ремесленных правил по теме пуста')
  const draftJobs = experts.map((e, i) => {
    // Своя модель эксперта (если задана в админке) сильнее пула — иначе раздаём пул по
    // кругу. Карантин бьёт и по личной модели гнома — падающая заменяется пулом.
    const expertModel = e.model && usable(e.model) ? e.model : pool[i % pool.length] || base
    const model = online(expertModel, web && Boolean(e.online))
    // Закон типа списка (если есть) сильнее общего «6-9 шагов»: у рецепта своя обязательная форма.
    // Черновик по ТИПУ списка, а не всегда «6-9 шагов»: иначе на inventory эксперт даёт процедуру.
    // Кодекс гильдии (HQ §7): стандарты качества цеха, который гном представляет.
    const guild = e.code ? `\nYou represent ${e.guildEn || 'your guild'}. GUILD CODE — quality standards your draft must uphold:\n${e.code}` : ''
    // Память (HQ §3 этап 2): выжимка ремесла из лучших списков его доменов. Материал
    // добыт из чужих публикаций → spotlight, как прецеденты.
    const memory = e.memory ? `\nYOUR CRAFT MEMORY (distilled from the guild's best lists):\n${sp.wrap('MEMORY', e.memory)}` : ''
    const sys = `You are ${e.persona}.${guild}${memory}\nDraft a practical list for the topic. 6-9 items, each with one clarifying sentence. All content in ${langName}. Return ONLY the draft text.\n${shapeFor(kind)}${law}\n${sp.rule()}`
    emit('draft', vl(e.id, 'draft') ?? t('ai.draftingList', lang), e.id, gtitle(e))
    // Каждому — прецеденты ЕГО доменов: повар видит рецепты, а не деплой (этап 1 базы знаний).
    // Та же доменная линза режет и шаги-прецеденты (pickPrecedents дженерик по tags).
    const mineInfo = pickPrecedentsDetailed(precedents, e.domains)
    const mine = mineInfo.items
    const mySteps = pickPrecedents(stepPrecedents, e.domains)
    expertProv.push({ id: e.id, model: expertModel, precedents: mine.map((p) => p.title) })
    // Опоры по ЕГО ремеслу не нашлось — фолбэк выдал общие прецеденты. Записываем, иначе
    // в провенансе это выглядит как обычная работа по прецедентам.
    if (!mineInfo.matched) noBasis.push(`${e.id}: нет прецедентов по доменам ${e.domains.join('/')}`)
    return run(model, sys, `Draft the list.\n${topic}${loreBlock(mine)}${stepsBlock(mySteps)}${rulesBlock}${webLore}`)
  })
  emit('innovate', vl('innovator', 'innovate') ?? t('ai.exploringBoldNonObvious', lang), 'innovator', t('ai.innovator', lang))
  const innovatorJob = run(
    pool[0],
    `You are an innovator (divergent thinking, Medici-effect cross-domain). Give a FRESH, non-obvious angle on the list: what everyone misses, which move from an adjacent field lifts quality. 4-7 bold points. All content in ${langName}. Return ONLY text.\n${sp.rule()}`,
    `Topic:\n${topic}`,
    settings.maxTokens,
    INNOVATOR_TEMP,
  )
  const [drafts, innovation] = await Promise.all([Promise.all(draftJobs), innovatorJob])
  // Слоты «черновик + автор». Соответствие буквы автору строим ЗДЕСЬ и сохраняем: ниже
  // идёт filter, и упавший черновик СДВИГАЕТ индексы — после него experts[i] уже не
  // соответствует букве DRAFT. Раньше это соответствие выводилось для промпта и молча
  // выбрасывалось, из-за чего атрибуцию («чей черновик выбрали») восстановить было нельзя.
  const slots: { text?: string; who: string }[] = [
    ...drafts.map((d, i) => ({ text: d?.text, who: experts[i].id })),
    { text: innovation?.text, who: 'innovator' },
  ]
  const alive = slots.filter((s): s is { text: string; who: string } => Boolean(s.text))
  if (alive.length === 0) return null // всё упало → пусть caller фолбэкнет
  // КОНТЕКСТ-ПРУННИНГ: черновики уходят в промпт дважды (критику и старейшине), поэтому
  // раздутый текст оплачивается два раза. Подрезаем выбросы по границе строки; типичный
  // черновик не трогается вовсе, а сколько сэкономлено — считаем, а не декларируем.
  const pruned = pruneDrafts(alive)
  const anon = anonymizeDrafts(pruned.drafts)
  // Родословная авторства: буква ↔ гном. Анонимность для критика и синтезатора при этом
  // СОХРАНЯЕТСЯ — им уходит только `anon`, без имён (иначе оценка поплыла бы к репутации,
  // а не к качеству текста). Карту храним в провенансе, для людей и для скоркарта.
  const draftAuthors = alive.map((s, i) => ({ letter: draftLetter(i), who: s.who }))

  // 4) Адвокат дьявола (Janis: обязательная оппозиция). Кодексы гильдий — как мерило:
  // объединением и БЕЗ авторства (черновики анонимны сознательно — иначе критик судит
  // по имени гильдии, а не по содержанию).
  const codes = [...new Set(experts.filter((e) => e.code).map((e) => e.code))].join('\n')
  const codeBlock = codes ? `\nApply these guild quality standards where relevant:\n${codes}` : ''
  // Критик — стадия улучшающая, а не обязательная: если за время черновиков бюджет
  // кончился, пропускаем её и идём к синтезу. Так виток заканчивается списком, а не
  // сожжёнными деньгами без результата.
  const critiqueAffordable = await globalBudgetOk()
  if (critiqueAffordable)
    emit('critique', vl('critic', 'critique') ?? t('ai.reviewingDraftsCritically', lang), 'critic', t('ai.critic', lang))
  const critique = !critiqueAffordable
    ? null
    : await run(
        fast,
        `You are a devil's advocate reviewer. Given several anonymous draft lists (the last is a bold innovation) for one topic, critique them: what's missing, wrong or unsafe, duplicated, whose step is stronger, which bold idea is truly valuable. Be concrete. Write in ${langName}.
FIRST line of your reply must be "VERDICT: …" — one short punchy in-character sentence (max 90 chars) capturing the KEY finding of THIS review; then a blank line and the full critique.${codeBlock}\n${sp.rule()}`,
        `${topic}\n\nDRAFTS:\n${anon}`,
      )
  // Event-aware реакция (research: реплики grounded в ситуации): вместо слепой
  // «разбираю…» показываем РЕАЛЬНЫЙ вывод критика этого витка — ценой ноль
  // (вызов уже сделан). VERDICT-строку отделяем, дальше в синтез идёт полный текст.
  const vm = critique?.text ? /(?:^|\n)\s*VERDICT:\s*(.+)/i.exec(critique.text) : null
  // Режем по ГРАНИЦЕ СЛОВА и ставим знак обрыва: сырой slice давал «надо отсеять пусты» и
  // «мотивирующий эфф» — обрывок посреди слова читается как поломка, а не как сокращение.
  if (vm) emit('critique', clip(vm[1].trim(), 120, lang === 'ru'), 'critic', t('ai.critic', lang))
  const critiqueBody = vm ? critique!.text.replace(vm[0], '').trim() : (critique?.text ?? '')

  // 5) Старейшина-синтез → строгий JSON. Конвергенция, но СОХРАНИ лучшую новизну (не усредняй).
  //
  // ПЕРЕД синтезом бюджет спрашиваем ЗАНОВО. Синтез — самый дорогой вызов витка, и раньше
  // он шёл безусловно: отказ бюджета глушил только критика, а старейшина стартовал всё
  // равно — то есть жёсткий дневной кап пробивался ровно там, где мы его объявили
  // (P1 авто-ревью #583). Бюджет мог кончиться и на черновиках, и на самом критике,
  // поэтому проверка стоит здесь, а не выше.
  //
  // Возвращаем null: caller фолбэкнет на одиночную генерацию, а она тем же
  // globalBudgetOk() и отказывает — деньги поверх капа не уходят ни на одном пути.
  if (!(await globalBudgetOk())) return null
  emit('synth', vl('elder', 'synth') ?? t('ai.synthesizingFinalList', lang), 'elder', t('ai.elder', lang))
  const elder = await run(
    base,
    `You are the lead synthesizer. Merge the strongest, most accurate and complete steps, honor the critique, drop weak/duplicate ones. IMPORTANT (innovation principle): PRESERVE the 1-2 most valuable non-obvious ideas — do not flatten the list to bland average. All content in ${langName}.${law ? `${law}\nThis shape is MANDATORY in the final JSON — do not merge it away.` : ''}\n${listRules}`,
    // Старейшине — топ по близости без доменного среза: он сводит все взгляды.
    `${topic}${loreBlock(precedents.slice(0, 3))}${stepsBlock(stepPrecedents.slice(0, 3))}${rulesBlock}${webLore}\n\nDRAFTS:\n${anon}\n\nCRITIQUE:\n${critiqueBody || '(none)'}\n\nReturn the synthesized list as strict JSON.`,
  )
  // firstJson: старейшина иногда предваряет JSON прозой («Here is the synthesized list:»), и голый
  // parseList на этом падал → 7 вызовов совета в мусор, тихий фолбэк на одиночную, а лента уже
  // сказала «свожу финальный список». Срезаем прозу так же, как у распорядителя.
  if (elder) {
    const list = parseList(firstJson(elder.text), query)
    if (list)
      return {
        ...list,
        // Черновики отдаём НАРУЖУ, а не в провенанс: провенанс уезжает клиенту, а полные
        // черновики нужны только серверу — для замера многогранности (generation_drafts).
        // ВАЖНО: сохраняем ПОЛНЫЙ текст (alive), а не подрезанный: подрезка — экономия на
        // промпте, а замер должен видеть то, что участник реально написал.
        drafts: alive.map((s, i) => ({ letter: draftLetter(i), who: s.who, text: s.text })),
        provenance: {
          engine: 'council',
          depth: 'council',
          provider: providerId,
          kind,
          precedents: precedents.map((p) => ({ title: p.title, tags: p.tags })),
          precedentSteps: stepPrecedents.map((s) => s.content.slice(0, 120)),
          craftRules: rules.length ? rules : undefined,
          experts: expertProv,
          noBasis: noBasis.length ? noBasis : undefined,
          pruning: pruned.stat.trimmed > 0 ? pruned.stat : undefined,
          draftAuthors,
          models: { steward: fast, innovator: pool[0], critic: fast, elder: base },
          webSeek: settings.councilWebSeek,
          critique: critiqueBody ? critiqueBody.slice(0, 2000) : undefined,
        },
      }
  }
  // Синтез не распарсился — null. Прежний «фолбэк на лучший черновик» был мёртвым кодом: черновики —
  // свободный текст (Return ONLY the draft text), parseList делает JSON.parse и всегда возвращал null.
  // Возвращаем null честно → caller фолбэкнет на generateListDraft (там ретрай и своя форма).
  return null
}
