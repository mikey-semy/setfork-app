import 'server-only'
import { generateText } from 'ai'
import { getAiSettings, modelAllowed, parseModelAllowlist } from '@/shared/settings/ai'
import { globalBudgetOk } from '@/shared/quota'
import { getAiChatClient } from './provider'
import { pickChatModel } from './credits'
import { baseModelId, filterByQuarantine, quarantinedModels } from './health'
import { extractUsage, outcomeOf, recordUsage, type AiFeature } from './usage'
import { spotlight, type Spotlight } from './spotlight'
import { parseList, jsonShapeFor, type GeneratedList, type GenerateOptions } from './generate'
import { classifyListKind, shapeFor, LIST_KINDS, type ListKind } from './list-kind'
import { findPrecedents, type Precedent } from './retrieval'
import { getRoster, type Expert } from './roster'
import { voiceLine, type VoiceKind } from './voice'
import { pickPrecedents } from './precedent-filter'
import { lawBlock } from './list-laws'
import { pushMessage, type GenMessageKind } from './generation-messages'
import { langEnName, type Lang } from '@/shared/i18n'

/**
 * «Совет гномов» — мультимодельная генерация списка (research 2026-07-13):
 *   распорядитель (глубина+созыв) → эксперты ∥ + новатор (дивергенция) → адвокат дьявола → старейшина-синтез.
 * Drop-in к generateListDraft: возвращает тот же GeneratedList. Каждый под-вызов пишется в aiUsage
 * (refType 'council'), уважает globalBudgetOk. Гейт — settings.councilEnabled (OFF по умолчанию).
 *
 * НЕ в этом инкременте (следующие): стрим беседы/UI, Pro-гейт, RAG-старейшина по нашим спискам
 * (pgvector), диалог/уточняющие вопросы, память сессии.
 */

const DEFAULT_COUNCIL_MODELS = ['openai/gpt-4o-mini', 'meta-llama/llama-3.3-70b-instruct', 'mistralai/mistral-nemo']
// Дефолтный пул для Яндекса: без него OpenRouter-дефолты фильтровались в пусто и
// совет МОЛЧА становился одномодельным. 4 семейства RU-hosted, цены известны
// (yandex-pricing); flash первым — он ведёт промежуточные шаги (цена/скорость).
const DEFAULT_YANDEX_POOL = ['aliceai-llm-flash', 'qwen3.6-35b-a3b', 'gpt-oss-120b', 'deepseek-v4-flash']
// У GigaChat одна семья — гетерогенность слабее (размеры вместо семейств).
const DEFAULT_GIGACHAT_POOL = ['GigaChat-2', 'GigaChat-2-Pro', 'GigaChat-2-Max']
const INNOVATOR_TEMP = 0.9
// Потолок на ОДИН вызов: зависшая/медленная модель не должна вешать весь совет (6-7 вызовов).
// Превышение → вызов падает → гном «выпадает», совет продолжает без него.
// 120с, а не 60: живой бенч (research/2026-07-18-council-bench) показал 33% отказов — под
// одновременностью вызовы (особенно синтез старейшины на большой модели с длинным промптом) не
// укладывались в 60с. При успехе совет ~4 мин, отдельные вызовы 60-120с — 60с резал их зря.
const CALL_TIMEOUT_MS = 120_000

function firstJson(t: string): string {
  const s = t.indexOf('{'), e = t.lastIndexOf('}')
  return s >= 0 && e > s ? t.slice(s, e + 1) : t
}
const online = (m: string, web: boolean) => (web && m ? `${m}:online` : m)

/**
 * Провенанс витка — объяснимость («почему ты это предложил тогда?», HQ §6):
 * кто участвовал и на чём, какие прецеденты пошли в чьи промпты, что сказал критик.
 * Собирается ИЗ ДАННЫХ, уже находящихся в руках совета — ни одного лишнего вызова.
 */
export interface CouncilProvenance {
  engine: 'council'
  depth: 'single' | 'council'
  provider: string
  kind: string
  /** Найденные прецеденты (до 10) — что вообще легло на стол. */
  precedents: { title: string; tags: string[] }[]
  /** По каждому гному: модель и СВОЙ срез прецедентов (после доменной линзы). */
  experts?: { id: string; model: string; precedents: string[] }[]
  models: { steward?: string; innovator?: string; critic?: string; elder?: string; single?: string }
  webSeek?: boolean
  /** Разбор критика (срез 2000) — раньше терялся вовсе. */
  critique?: string
}

/** Результат совета: готовый список (+провенанс), ИЛИ уточняющие вопросы (диалог), ИЛИ null (ошибка/выкл → фолбэк). */
export type CouncilResult = (GeneratedList & { provenance?: CouncilProvenance }) | { clarify: string[] } | null

/** Мультимодельный «совет гномов». null при ошибке/выкл — caller фолбэкает на generateListDraft. */
export async function generateListCouncil(query: string, lang: Lang, opts: GenerateOptions = {}): Promise<CouncilResult> {
  const client = await getAiChatClient()
  if (!client) return null
  // В замыкание run (function declaration) сужение client не протекает — фиксируем поля.
  const chat = client.chat
  const providerId = client.cfg.provider
  const settings = await getAiSettings()
  if (!settings.enabled) return null
  if (!(await globalBudgetOk())) return null
  const langName = langEnName(lang)
  const base = await pickChatModel(settings) // конфигурируемая модель — для ФИНАЛЬНОГО списка (качество)
  // Пул/ростер могли остаться с моделями другого провайдера (у Яндекса id строго
  // gpt://…): несовместимые отсеиваем, пустой пул → база. У Selectel id в стиле
  // OpenRouter — проходят как есть.
  const forProvider = (m: string) =>
    client.cfg.provider === 'yandex'
      ? m.startsWith('gpt://')
      : client.cfg.provider === 'gigachat'
        ? !m.includes('/') // id GigaChat без слешей; чужие — vendor/model или gpt://
        : true
  const yandexFolder = client.cfg.headers?.['x-folder-id'] ?? ''
  const defaultPool =
    client.cfg.provider === 'yandex' && yandexFolder
      ? DEFAULT_YANDEX_POOL.map((n) => `gpt://${yandexFolder}/${n}/latest`)
      : client.cfg.provider === 'gigachat'
        ? DEFAULT_GIGACHAT_POOL
        : DEFAULT_COUNCIL_MODELS
  const rawPool = settings.councilModels.length ? settings.councilModels : defaultPool
  // АВТОРОТАЦИЯ: модели с проседающим success-rate за сутки (журнал ai_usage)
  // временно выпадают из ротации; окно скользящее — возврат автоматический.
  const quarantined = await quarantinedModels()
  const allowlist = parseModelAllowlist()
  const usable = (m: string) => forProvider(m) && modelAllowed(m, allowlist) && !quarantined.has(baseModelId(m))
  const pool = filterByQuarantine(rawPool.filter(forProvider), quarantined)
  // Быстрая модель для ПРОМЕЖУТОЧНЫХ шагов (распорядитель-классификатор, критик, веб-поиск):
  // reasoning-модель там не нужна, а совет из 6-7 вызовов на ней тормозит минутами. Финал — на base.
  const fast = pool[0] || base
  // Ростер — из БД (админка); пустая таблица → сид исходным составом, ошибка → SEED.
  const EXPERTS = await getRoster()
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
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  // Подпись говорящего в беседе (идентичность роли несёт аватарка, поэтому эмодзи в ростере больше нет).
  const gtitle = (e: Expert) => (ru ? e.nameRu : e.nameEn)
  // Беседа: пишем ход совета в БД (по refId=generationId). Виток = variant (idx кандидата) —
  // реплики разных попыток не мешаются, а группируются, поэтому ленту больше не надо стирать.
  // fire-and-forget: запись реплики не должна блокировать/ронять генерацию.
  const attempt = opts.variant ?? 1
  const emit = (kind: GenMessageKind, text: string, who?: string, name?: string) => {
    if (opts.refId) void pushMessage(opts.refId, { attempt, kind, text, who, name }).catch(() => {})
  }
  // Голоса гномов (voice.ts): seed стабилен на виток — реплики попытки детерминированы,
  // между попытками разные. null (кастомный эксперт без голоса) → нейтральный текст сайта вызова.
  const vseed = `${opts.refId ?? query}:${attempt}`
  const vl = (who: string, kind: VoiceKind, vars?: Record<string, string>) => voiceLine(who, kind, lang, vseed, vars)

  // Один под-вызов: генерация + учёт расхода. Ошибка → null (гном «выпал»), совет продолжает.
  // ОДИН ретрай на транзиентной ошибке (таймаут/сеть/429/5xx): бенч показал, что 33% отказов —
  // это упавшие под нагрузкой ОДИНОЧНЫЕ вызовы (чаще синтез старейшины), а не детерминированный сбой.
  // Ретрай именно транзиента бьёт по хвосту, не удваивая цену на стабильных ответах.
  async function run(model: string, system: string, prompt: string, maxTokens = settings.maxTokens, temp = settings.temperature): Promise<{ text: string } | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const startedAt = Date.now()
      try {
        const result = await generateText({
          model: chat(model),
          system,
          prompt,
          temperature: temp,
          maxOutputTokens: maxTokens,
          abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        })
        const u = extractUsage(result)
        await recordUsage({ userId: opts.userId, feature, model, input: u.input, output: u.output, total: u.total, cost: u.cost, refType: opts.refType ?? 'council', refId: opts.refId, outcome: 'ok', durationMs: Date.now() - startedAt, provider: providerId })
        return { text: result.text }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        // Каждый ФИЗИЧЕСКИЙ вызов попадает в журнал (и ретраи) — иначе щиток
        // надёжности видел бы только успехи и карантин никогда бы не срабатывал.
        await recordUsage({ userId: opts.userId, feature, model, input: 0, output: 0, total: 0, cost: 0, refType: opts.refType ?? 'council', refId: opts.refId, outcome: outcomeOf(e), durationMs: Date.now() - startedAt, provider: providerId })
        const transient = /timeout|abort|econnreset|fetch failed|network|socket|429|50[234]/i.test(msg)
        if (attempt === 0 && transient) {
          console.warn('[council] call retry', msg)
          continue
        }
        console.warn('[council] call failed', msg)
        return null
      }
    }
    return null
  }

  // 1) Распорядитель: глубина (single|council|clarify) + созыв экспертов по домену (адаптивная глубина = лимит цены).
  const roster = EXPERTS.map((e) => `${e.id}: ${e.persona} [${e.domains.join(',')}]`).join('\n')
  const clarifyLine = settings.councilClarify
    ? '- depth "clarify": the request is too vague for a useful list — a bare fragment or pronoun ("organize it", "plan the thing", "help me"), OR the good answer hinges on unstated parameters (budget / skill level / goal / constraints). Return 2-3 short clarifying questions in "questions". PREFER clarify over single/council whenever the request is underspecified this way.\n'
    : ''
  // «kind» распорядитель решает тем же дешёвым вызовом, что и глубину/состав — стоит ~0. Это LLM-слой
  // классификации типа списка (ADR-0010) поверх грамматического дефолта classifyListKind (fallback ниже).
  const kindField = `"kind":"procedure|inventory|checklist|criteria|options"`
  const jsonShape = settings.councilClarify
    ? `{"depth":"single|council|clarify",${kindField},"summon":["id",...],"questions":["...only if clarify"],"reason":"short"}`
    : `{"depth":"single|council",${kindField},"summon":["id",...],"reason":"short"}`
  const steward = await run(
    fast,
    `You are the steward of a panel of domain experts building a reference list. Choose process depth, the LIST KIND, and summon experts.
${clarifyLine}- depth "single": the topic is clear AND simple/everyday (chores, basic personal routines) — no council needed.
- depth "council": the topic is clear but technical/multi-faceted/professional — summon 1-${maxGnomes} RELEVANT, DIVERSE experts from the roster.
- kind: what the ELEMENT of the list is. "procedure" = ordered steps to DO (how-to). "inventory" = THINGS to get/have (accessories, gear, ingredients, packing/shopping list). "checklist" = states to verify. "criteria" = rules for choosing/judging. "options" = variants to compare. Pick by what the user actually wants: "what accessories do I need" → inventory, NOT procedure.
MATCH THE TOPIC TO THE ROSTER BY DOMAIN (the topic may be in ANY language): a recipe/dish/cooking → chef; a workout/health → coach; a trip/city → traveler; deploy/servers/CI → devops; code/API/library → coder; study/course → scholar. Use 'generalist' ONLY when nothing fits.
Return ONLY JSON: ${jsonShape}
${sp.rule()}
ROSTER:
${roster}`,
    `REQUEST:\n${topic}`,
    220,
  )
  let depth: 'single' | 'council' | 'clarify' = 'council'
  let ids: string[] = []
  let questions: string[] = []
  // opts.kind (выбор пользователя-переключателя) — ЖЁСТКИЙ: распорядитель его не трогает.
  // Иначе — грамматический дефолт, а распорядитель уточняет своим LLM-решением, если оно валидно.
  const kindForced = Boolean(opts.kind)
  let kind: ListKind = opts.kind ?? classifyListKind(query)
  if (steward) {
    try {
      const p = JSON.parse(firstJson(steward.text)) as { depth?: string; kind?: string; summon?: string[]; questions?: string[] }
      if (p.depth === 'single') depth = 'single'
      else if (p.depth === 'clarify' && settings.councilClarify) depth = 'clarify'
      if (!kindForced && p.kind && (LIST_KINDS as string[]).includes(p.kind)) kind = p.kind as ListKind
      ids = Array.isArray(p.summon) ? p.summon : []
      questions = Array.isArray(p.questions) ? p.questions.filter((q) => typeof q === 'string' && q.trim()).map((q) => q.trim()).slice(0, 3) : []
    } catch { /* дефолт council */ }
  }

  // Диалог: не хватает ключевого → возвращаем уточняющие вопросы (совет не гоним, ждём ответов пользователя).
  if (depth === 'clarify' && questions.length) {
    emit('plan', vl('reporter', 'clarify') ?? say('The request is vague — I need a couple of details', 'Запрос размытый — нужна пара деталей'), 'reporter', say('Reporter', 'Репортёр'))
    return { clarify: questions }
  }

  // law — обязательная форма типа списка (напр. рецепт). Раньше её тут НЕ было, и получался парадокс:
  // совет ВЫКЛ → рецепт правильный (generate.ts закон применяет), совет ВКЛ + «тема простая» → сломан.
  // Закон отсутствовал ровно в single-ветке совета, ради которой он и писался.
  // Форма по типу списка (kind): та же структура JSON, иной смысл элемента (ADR-0010).
  const listRules = `You produce a canonical, high-quality reference list. All content MUST be in ${langName}.${law}\n${jsonShapeFor(kind)}\n${sp.rule()}`

  // Тривиально → один гном (обычная генерация, но через тот же учёт совета).
  if (depth === 'single') {
    emit('plan', vl('planner', 'plan-single') ?? say('Simple topic — writing it up right away', 'Тема простая — пишу сразу'), 'planner', say('Planner', 'Планировщик'))
    const one = await run(online(base, web), listRules, `Create the reference list for the topic below.\n${topic}`)
    const single = one ? parseList(firstJson(one.text), query) : null
    return single
      ? { ...single, provenance: { engine: 'council', depth: 'single', provider: providerId, kind, precedents: [], models: { single: base } } }
      : null
  }
  emit('plan', vl('planner', 'plan-council') ?? say('The topic is many-sided — convening the council', 'Тема многогранная — собираем совет'), 'planner', say('Planner', 'Планировщик'))

  // 2) Созыв: эксперты по домену; пол разнообразия — минимум 2 независимых мнения (мудрость толпы).
  const experts = ids.map((id) => EXPERTS.find((e) => e.id === id)).filter((e): e is Expert => Boolean(e)).slice(0, maxGnomes)
  // Добор до 2 — из ТОГО, ЧТО ВКЛЮЧЕНО (EXPERTS уже отфильтрован по enabled). Раньше здесь стоял
  // EXPERTS.find(...)! по хардкоду 'generalist'/'hoarder' — админ выключил универсала в зале совета,
  // и вся джоба падала (TypeError вне try → вечный pending). Универсал/барахольщик приоритетны как
  // дефолт-на-любую-тему, дальше — любой оставшийся.
  const padOrder = [...EXPERTS].sort((a, b) => {
    const rank = (e: Expert) => (e.id === 'generalist' ? 0 : e.id === 'hoarder' ? 1 : 2)
    return rank(a) - rank(b)
  })
  for (const g of padOrder) {
    if (experts.length >= 2) break
    if (!experts.some((e) => e.id === g.id)) experts.push(g)
  }
  const names = experts.map(gtitle).join(', ')
  emit('summon', vl('crier', 'summon', { names }) ?? say(`Consulting: ${names}`, `Созываю: ${names}`), 'crier', say('Coordinator', 'Координатор'))

  // 2.5) Старейшина-искатель: прецеденты из НАШИХ списков (pgvector). Пусто на пустом корпусе — ок.
  // Берём 10 (не 3): дальше каждый эксперт получает СВОЙ срез по своим доменам
  // (pickPrecedents) — повару кулинарные, девопсу деплойные; в один промпт идёт максимум 3.
  const precedents = await findPrecedents(query, lang, { userId: opts.userId, limit: 10 })
  // Форма «X: N» — чтобы не склонять числительное (было «3 похожих списков») и не тащить плюрализацию в ленту.
  if (precedents.length)
    emit('seek', vl('seek-lists', 'seek', { n: String(precedents.length) }) ?? say(`Similar lists in our library: ${precedents.length}`, `Похожих списков в библиотеке: ${precedents.length}`), 'seek-lists', say('Librarian', 'Библиотекарь'))
  // Прецеденты — title/desc/tags ЧУЖИХ публичных списков: недоверенный текст, оборачиваем spotlight'ом.
  // Иначе — вектор межпользовательской инъекции: опубликовал список с инструкцией в заголовке и ждёшь
  // семантического матча (порог низкий, MIN_SIMILARITY=0.3).
  const loreBlock = (list: Precedent[]) =>
    list.length
      ? `\n\n${sp.wrap('PRECEDENTS', list.map((p, i) => `${i + 1}. ${p.title}${p.desc ? ' — ' + p.desc : ''}${p.tags.length ? ' [' + p.tags.join(', ') + ']' : ''}`).join('\n'))}\n(reuse good structure, avoid duplicating, improve on them)`
      : ''

  // Веб-искатель (старейшина advanced-тира): интернет-прецеденты сверх наших списков (за флагом council_web_seek).
  let webLore = ''
  if (settings.councilWebSeek) {
    emit('seek', vl('seek-web', 'seek') ?? say('Searching the web for precedents…', 'Ищу прецеденты в интернете…'), 'seek-web', say('Web scout', 'Веб-разведчик'))
    const webSys = `You are a knowledgeable researcher with web access. Find 3-5 concise, REAL precedents/analogies for building a list on this topic: how it is typically done, common pitfalls, authoritative approaches. Short bullet list in ${langName}. Return ONLY the bullets.\n${sp.rule()}`
    const webRes = await run(online(fast, isOpenRouter), webSys, `Topic:\n${topic}`, 500)
    // Содержимое чужих веб-страниц — тоже недоверенный текст: оборачиваем, не вставляем сырьём.
    if (webRes && webRes.text.trim()) webLore = `\n\n${sp.wrap('WEB_PRECEDENTS', webRes.text.trim())}\n(verify, don't copy blindly)`
  }

  // 3) Эксперты набрасывают НЕЗАВИСИМО ∥ (получая прецеденты) + гном-новатор (дивергенция, temp↑, БЕЗ прецедентов — чтобы расходился).
  const expertProv: NonNullable<CouncilProvenance['experts']> = []
  const draftJobs = experts.map((e, i) => {
    // Своя модель эксперта (если задана в админке) сильнее пула — иначе раздаём пул по
    // кругу. Карантин бьёт и по личной модели гнома — падающая заменяется пулом.
    const expertModel = e.model && usable(e.model) ? e.model : pool[i % pool.length] || base
    const model = online(expertModel, web && Boolean(e.online))
    // Закон типа списка (если есть) сильнее общего «6-9 шагов»: у рецепта своя обязательная форма.
    // Черновик по ТИПУ списка, а не всегда «6-9 шагов»: иначе на inventory эксперт даёт процедуру.
    const sys = `You are ${e.persona}. Draft a practical list for the topic. 6-9 items, each with one clarifying sentence. All content in ${langName}. Return ONLY the draft text.\n${shapeFor(kind)}${law}\n${sp.rule()}`
    emit('draft', vl(e.id, 'draft') ?? say('drafting the list…', 'набрасывает список…'), e.id, gtitle(e))
    // Каждому — прецеденты ЕГО доменов: повар видит рецепты, а не деплой (этап 1 базы знаний).
    const mine = pickPrecedents(precedents, e.domains)
    expertProv.push({ id: e.id, model: expertModel, precedents: mine.map((p) => p.title) })
    return run(model, sys, `Draft the list.\n${topic}${loreBlock(mine)}${webLore}`)
  })
  emit('innovate', vl('innovator', 'innovate') ?? say('Exploring a bold, non-obvious angle…', 'Ищу смелый неочевидный ход…'), 'innovator', say('Innovator', 'Новатор'))
  const innovatorJob = run(
    pool[0],
    `You are an innovator (divergent thinking, Medici-effect cross-domain). Give a FRESH, non-obvious angle on the list: what everyone misses, which move from an adjacent field lifts quality. 4-7 bold points. All content in ${langName}. Return ONLY text.\n${sp.rule()}`,
    `Topic:\n${topic}`,
    settings.maxTokens,
    INNOVATOR_TEMP,
  )
  const [drafts, innovation] = await Promise.all([Promise.all(draftJobs), innovatorJob])
  const pooled = [...drafts, innovation].filter((d): d is { text: string } => Boolean(d))
  if (pooled.length === 0) return null // всё упало → пусть caller фолбэкнет
  // Черновики — свободный текст (не JSON): передаём СЫРЬЁМ. firstJson здесь порезал бы шаги со скобками
  // (напр. `awk '{print $1}'`, `${HOME}/bin`) — только для JSON-ответа распорядителя/синтеза.
  const anon = pooled.map((d, i) => `--- DRAFT ${String.fromCharCode(65 + i)} ---\n${d.text.trim()}`).join('\n\n')

  // 4) Адвокат дьявола (Janis: обязательная оппозиция).
  emit('critique', vl('critic', 'critique') ?? say('Reviewing the drafts critically…', 'Критически разбираю черновики…'), 'critic', say('Critic', 'Критик'))
  const critique = await run(
    fast,
    `You are a devil's advocate reviewer. Given several anonymous draft lists (the last is a bold innovation) for one topic, critique them: what's missing, wrong or unsafe, duplicated, whose step is stronger, which bold idea is truly valuable. Be concrete. Write in ${langName}.\n${sp.rule()}`,
    `${topic}\n\nDRAFTS:\n${anon}`,
  )

  // 5) Старейшина-синтез → строгий JSON. Конвергенция, но СОХРАНИ лучшую новизну (не усредняй).
  emit('synth', vl('elder', 'synth') ?? say('Synthesizing the final list…', 'Свожу финальный список…'), 'elder', say('Elder', 'Старейшина'))
  const elder = await run(
    base,
    `You are the lead synthesizer. Merge the strongest, most accurate and complete steps, honor the critique, drop weak/duplicate ones. IMPORTANT (innovation principle): PRESERVE the 1-2 most valuable non-obvious ideas — do not flatten the list to bland average. All content in ${langName}.${law ? `${law}\nThis shape is MANDATORY in the final JSON — do not merge it away.` : ''}\n${listRules}`,
    // Старейшине — топ по близости без доменного среза: он сводит все взгляды.
    `${topic}${loreBlock(precedents.slice(0, 3))}${webLore}\n\nDRAFTS:\n${anon}\n\nCRITIQUE:\n${critique?.text ?? '(none)'}\n\nReturn the synthesized list as strict JSON.`,
  )
  // firstJson: старейшина иногда предваряет JSON прозой («Here is the synthesized list:»), и голый
  // parseList на этом падал → 7 вызовов совета в мусор, тихий фолбэк на одиночную, а лента уже
  // сказала «свожу финальный список». Срезаем прозу так же, как у распорядителя.
  if (elder) {
    const list = parseList(firstJson(elder.text), query)
    if (list)
      return {
        ...list,
        provenance: {
          engine: 'council',
          depth: 'council',
          provider: providerId,
          kind,
          precedents: precedents.map((p) => ({ title: p.title, tags: p.tags })),
          experts: expertProv,
          models: { steward: fast, innovator: pool[0], critic: fast, elder: base },
          webSeek: settings.councilWebSeek,
          critique: critique?.text ? critique.text.slice(0, 2000) : undefined,
        },
      }
  }
  // Синтез не распарсился — null. Прежний «фолбэк на лучший черновик» был мёртвым кодом: черновики —
  // свободный текст (Return ONLY the draft text), parseList делает JSON.parse и всегда возвращал null.
  // Возвращаем null честно → caller фолбэкнет на generateListDraft (там ретрай и своя форма).
  return null
}
