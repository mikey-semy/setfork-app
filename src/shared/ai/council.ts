import 'server-only'
import { generateText } from 'ai'
import { getAiSettings, modelAllowed, parseModelAllowlist } from '@/shared/settings/ai'
import { globalBudgetOk } from '@/shared/quota'
import { getAiChatClient } from './provider'
import { pickChatModel } from './credits'
import { baseModelId, filterByQuarantine, quarantinedModels } from './health'
import { gnomeMood, gnomeReputation, gnomeThanksCounts, repScore } from './gnome-reputation'
import { extractUsage, outcomeOf, recordUsage, type AiFeature } from './usage'
import { spotlight, type Spotlight } from './spotlight'
import { parseList, jsonShapeFor, type GeneratedList, type GenerateOptions } from './generate'
import { classifyListKind, shapeFor, LIST_KINDS, type ListKind } from './list-kind'
import { findPrecedents, type Precedent, type StepPrecedent } from './retrieval'
import { getRoster, type Expert } from './roster'
import { voiceLine, type VoiceKind } from './voice'
import { gnomeCard, rivalryHints } from './gnome-character'
import { pickPrecedents, pickPrecedentsDetailed } from './precedent-filter'
import { pruneDrafts } from './prune'
import { craftRules } from './triples'
import { lawBlock } from './list-laws'
import { pushMessage, type GenMessageKind } from './generation-messages'
import { t, langEnName, type Lang } from '@/shared/i18n'

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
  /** Шаги-прецеденты (kind='step', #index-chunks) — срезом первых 120 символов. */
  precedentSteps?: string[]
  /** Ремесленные правила из базы троек (KAG) — какие связи легли в промпты. */
  craftRules?: string[]
  /** По каждому гному: модель и СВОЙ срез прецедентов (после доменной линзы). */
  experts?: { id: string; model: string; precedents: string[] }[]
  models: { steward?: string; innovator?: string; critic?: string; elder?: string; single?: string }
  webSeek?: boolean
  /** Разбор критика (срез 2000) — раньше терялся вовсе. */
  critique?: string
  /**
   * ГДЕ НЕ БЫЛО ОПОРЫ — структурно, без единого лишнего вызова модели.
   *
   * Фолбэк доменной линзы («по твоему ремеслу в библиотеке ничего нет — вот общие
   * прецеденты») делает промпт непустым, но маскирует пробел: эксперт пишет так же
   * уверенно, как если бы опора была. Здесь перечислено, у кого опоры не было и чего не
   * хватало витку в целом — читается как «вот тут мы додумывали».
   */
  noBasis?: string[]
  /**
   * Подрезка контекста на рёбрах: символов до/после и сколько черновиков подрезано. Умножать
   * на два — черновики идут и критику, и старейшине. Ноль подрезанных = обычный виток.
   */
  pruning?: { before: number; after: number; trimmed: number }
  /**
   * Карта «буква анонимного черновика → автор». Критик и синтезатор имён НЕ видят
   * (анонимность обязательна: иначе оценка плывёт к репутации, а не к качеству текста),
   * но для скоркарта и для людей соответствие нужно — раньше оно вычислялось для
   * промпта и выбрасывалось, поэтому «чей черновик выбрали» восстановить было нельзя.
   */
  draftAuthors?: { letter: string; who: string }[]
}

/** Черновик эксперта как есть — сырьё для замера многогранности (см. generation_drafts). */
export interface CouncilDraft {
  letter: string
  who: string
  text: string
}


/** Буква черновика в анонимном блоке: A, B, C… — единственное, чем он подписан. */
export const draftLetter = (i: number) => String.fromCharCode(65 + i)

/**
 * Обрезка реплики для ленты хода совета: по границе слова, с многоточием.
 *
 * Внутренние ярлыки черновиков (DRAFT A/B/C) заодно переводим на человеческий: пользователю
 * незачем знать нашу внутреннюю нумерацию, а латиница посреди русской реплики — это утечка
 * потрохов наружу, чем она и является.
 */
/** Подпись черновика словами — картой, а не тернарником: правило i18n не пускает
 *  «строка ? строка», и справедливо: это пользовательский текст, а не техническая метка. */
const DRAFT_LABEL = { ru: 'вариант', en: 'draft' } as const

export function clip(raw: string, max: number, ru = true): string {
  // Подпись следует языку интерфейса: русское слово в английской ленте — та же утечка
  // наизнанку, что и латинский ярлык в русской (находка ревью на #555).
  const label = DRAFT_LABEL[ru ? 'ru' : 'en']
  const human = raw.replace(/DRAFT\s+([A-Z])/g, (_m, letter) => `${label} ${letter}`)
  if (human.length <= max) return human
  const cut = human.slice(0, max)
  const at = cut.lastIndexOf(' ')
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`
}

/**
 * Анонимный блок черновиков для критика и старейшины.
 *
 * ИНВАРИАНТ: в этот текст не попадает НИЧЕГО об авторстве — ни id гнома, ни имя, ни гильдия.
 * Это не стилистика, а защита от provenance paradox (arXiv 2603.18043): как только оценщик
 * видит, кто написал, оценка плывёт к репутации автора, и маршрутизация начинает выбирать
 * худших. Функция вынесена наружу именно затем, чтобы инвариант проверялся тестом, а не
 * держался на внимательности при следующей правке промпта.
 *
 * Черновики передаются СЫРЬЁМ (не через firstJson): они свободный текст, и обрезка по первой
 * JSON-скобке порезала бы шаги вида `awk '{print $1}'` или `${HOME}/bin`.
 */
export function anonymizeDrafts(drafts: { text: string }[]): string {
  return drafts.map((d, i) => `--- DRAFT ${draftLetter(i)} ---\n${d.text.trim()}`).join('\n\n')
}

/** Результат совета: готовый список (+провенанс), ИЛИ уточняющие вопросы (диалог), ИЛИ null (ошибка/выкл → фолбэк). */
export type CouncilResult =
  | (GeneratedList & { provenance?: CouncilProvenance; drafts?: CouncilDraft[] })
  | { clarify: string[] }
  | null

/** Мультимодельный «совет гномов». null при ошибке/выкл — caller фолбэкает на generateListDraft. */
/**
 * ПУЛ СОВЕТА из сырого списка моделей. Три правила, и все три нужны:
 *
 * 1. Провайдер и белый список — жёсткие. Модель чужого провайдера просто не ответит,
 *    а белый список — прямой запрет владельца стенда.
 * 2. Карантин — мягкий. Если просели ВСЕ модели, работаем на просевших: медленный совет
 *    лучше отсутствующего (так вёл себя filterByQuarantine и до белого списка).
 * 3. Пустым пул быть не может. Новатору достаётся pool[0], и на пустом пуле это
 *    undefined — вызов без модели вместо расходящегося черновика (P1 из авто-ревью).
 *    Когда жёсткие фильтры выметают всё, остаётся base: она уже прошла белый список
 *    при чтении настроек (shared/settings/ai.ts).
 */
export function buildCouncilPool(
  rawPool: string[],
  permitted: (m: string) => boolean,
  quarantined: ReadonlySet<string>,
  base: string,
): string[] {
  const hard = rawPool.filter(permitted)
  return hard.length ? filterByQuarantine(hard, quarantined) : [base]
}

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
  // Провайдер и белый список — ЖЁСТКИЕ: их обходить нельзя, ради этого список и заводят.
  const permitted = (m: string) => forProvider(m) && modelAllowed(m, allowlist)
  const usable = (m: string) => permitted(m) && !quarantined.has(baseModelId(m))
  // Пул собираем тем же правилом, что и модели личных специалистов: раньше здесь стоял
  // только фильтр провайдера, и при заданном AI_MODEL_ALLOWLIST ограничение обходилось
  // самым дорогим путём — быстрой моделью, ротацией экспертов, критиком и старейшиной.
  const pool = buildCouncilPool(rawPool, permitted, quarantined, base)
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
  // LLM-шлифовка реплик (HQ §2, этап 2): ОДИН flash-вызов на весь совет, стартует
  // параллельно со стюардом и НЕ блокирует: не успел к событию — статичный голос,
  // успел — реплика живая и ПО ТЕМЕ. События с переменными ({names}/{n}) ТОЖЕ
  // шлифуются: модель оставляет токен в тексте, здесь подставляем — иначе созыв
  // и поиск вечно на статике и заметно повторялись (фидбек владельца про «робота»).
  let polished: Record<string, string> | null = null
  const vl = (who: string, kind: VoiceKind, vars?: Record<string, string>) => {
    let line = polished?.[`${who}:${kind}`]
    if (line && vars) for (const [k, v] of Object.entries(vars)) line = line.replaceAll(`{${k}}`, v)
    return line ?? voiceLine(who, kind, lang, vseed, vars)
  }

  // Один под-вызов: генерация + учёт расхода. Ошибка → null (гном «выпал»), совет продолжает.
  // ОДИН ретрай на транзиентной ошибке (таймаут/сеть/429/5xx): бенч показал, что 33% отказов —
  // это упавшие под нагрузкой ОДИНОЧНЫЕ вызовы (чаще синтез старейшины), а не детерминированный сбой.
  // Ретрай именно транзиента бьёт по хвосту, не удваивая цену на стабильных ответах.
  // gnomeId — КТО расходовал: без него журнал знал только модель, и «сколько тратит этот
  // мастер» нельзя было отделить от «как ведёт себя эта модель». Служебные шаги
  // (распорядитель, критик, старейшина) передают свою роль, а не пустоту.
  async function run(model: string, system: string, prompt: string, maxTokens = settings.maxTokens, temp = settings.temperature, gnomeId = ''): Promise<{ text: string } | null> {
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
        await recordUsage({ userId: opts.userId, feature, model, input: u.input, output: u.output, total: u.total, cost: u.cost, refType: opts.refType ?? 'council', refId: opts.refId, outcome: 'ok', durationMs: Date.now() - startedAt, provider: providerId, gnomeId })
        return { text: result.text }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        // Каждый ФИЗИЧЕСКИЙ вызов попадает в журнал (и ретраи) — иначе щиток
        // надёжности видел бы только успехи и карантин никогда бы не срабатывал.
        await recordUsage({ userId: opts.userId, feature, model, input: 0, output: 0, total: 0, cost: 0, refType: opts.refType ?? 'council', refId: opts.refId, outcome: outcomeOf(e), durationMs: Date.now() - startedAt, provider: providerId, gnomeId })
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

  // Шлифовка стартует ЗДЕСЬ (до стюарда): к поздним стадиям (драфт/критика/синтез)
  // реплики почти всегда успевают; ранние возьмут статичный голос — тоже норм.
  void (async () => {
    try {
      const events = [
        'planner:plan-single',
        'planner:plan-council',
        'reporter:clarify',
        'crier:summon', // с токеном {names} — подставим созванных
        'seek-lists:seek', // с токеном {n} — число прецедентов
        ...EXPERTS.map((e) => `${e.id}:draft`),
        'innovator:innovate',
        'critic:critique',
        'elder:synth',
      ]
      // Character cards (одушевление, HQ §3): каждый гном — РАЗНЫЙ. Карточка =
      // «семя» стиля (трейт+тик+эмодзи), из которого модель генерит СВЕЖУЮ реплику
      // (few-shot по research: не показываем статику дословно — она «робот»).
      // + НАСТРОЕНИЕ (RPG-развитие): демеанор из послужного списка гнома — часто
      // отклоняют → ворчливый, часто принимают → окрылённый. Реальный сигнал в стиль.
      const [moodRep, thanksN] = await Promise.all([gnomeReputation(), gnomeThanksCounts()])
      const whoIds = ['planner', 'reporter', 'innovator', 'critic', 'elder', ...EXPERTS.map((e) => e.id)]
      const cards = whoIds
        .map((id) => {
          const c = gnomeCard(id)
          const mood = gnomeMood(moodRep, id, thanksN[id] ?? 0).style
          return `${id}: ${c.trait}; тик — ${c.quirk}; эмодзи ${c.emoji}${mood ? `; настроение сейчас — ${mood}` : ''}`
        })
        .join('\n')
      const res = await run(
        fast,
        `You voice a gnome-workshop council working on the topic. Each gnome has a DISTINCT character (cards below). Write ONE opening line for each event key "who:kind" — what THAT gnome says as its step starts.
RULES: make every line UNMISTAKABLY that gnome — show emotion, humor and their quirk, never a dry status report; a good workshop banters. In 1-2 lines let a gnome throw a GOOD-NATURED jab at a rival per the rivalries below (playful, never mean) — it makes the council memorable. VARY the wording freely every time (never a stock phrase); tie it to the topic naturally. An emoji fits SOME lines (≤1 per line, not every line). Max 90 characters, no quotes. Language: ${langName}.
For "crier:summon" put the literal token {names} where the summoned gnomes are named. For "seek-lists:seek" put the literal token {n} where the count of found precedents goes.
CHARACTERS:
${cards}
RIVALRIES (playful, for banter):
${rivalryHints()}
Return ONLY a JSON object mapping every event key to its line.\n${sp.rule()}`,
        `TOPIC: ${topic}\nKEYS:\n${events.join('\n')}`,
        800,
      )
      if (res) {
        const obj = JSON.parse(firstJson(res.text)) as Record<string, unknown>
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(obj)) if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 90)
        if (Object.keys(out).length) polished = out
      }
    } catch {
      // статичные голоса — нормальный фолбэк
    }
  })()

  // 0) ГЕЙТ БЕСЕДЫ — отдельный фокусный вызов (HQ §clarify): решение «нужны ли
  // вопросы» вынесено из стюарда, потому что fast-модель Яндекса, делая 4 задачи
  // разом (глубина+тип+состав+вопросы), почти всегда роняла именно вопросы —
  // «Деплой на VPS» уходил в совет без беседы. Отдельная задача с примерами в обе
  // стороны исполняется надёжно. Только на ПЕРВОМ витке и пока пользователь ещё
  // не отвечал (иначе зациклимся): [User clarifications] дописывает answerClarify.
  const alreadyClarified = /\[User clarifications\]/i.test(query)
  if (settings.councilClarify && attempt === 1 && !alreadyClarified) {
    const gate = await run(
      fast,
      `You decide whether a list-generating council must ASK the user 2-3 questions FIRST, or can proceed right away.
ASK when the request is underspecified — a bare fragment/pronoun ("organize it", "help me"), or a broad activity/goal whose good list depends on unstated parameters: stack/OS, skill level, budget, goal, scope, audience, constraints.
  Examples that MUST ask: "Deploy to a VPS" (which stack? OS? zero-downtime?), "Deploy an app on a VPS", "Learn guitar" (genre? level?), "Plan a trip" (where? days? budget?), "Start a business", "Get fit", "Организовать переезд".
PROCEED (no questions) when the request already names a concrete, self-contained subject: a specific dish ("домашний зефир"), a specific book/topic list ("книги про гномов"), a specific well-scoped how-to ("настроить бэкапы Postgres на VPS в S3").
When asking: write 2-3 SHORT questions. ALL questions and options MUST be written in ${langName} — this is not a preference, it is the language of the person who asked. Where natural, append 2-4 quick answer OPTIONS after a "|": "Which stack? | Node.js | Python | PHP | Docker". Starting with questions is GOOD service, not friction.
Return ONLY JSON: {"ask": true|false, "questions": ["...only if ask"]}
${sp.rule()}`,
      `REQUEST:\n${topic}`,
      220,
    )
    let gateQuestions: string[] = []
    let ask = false
    if (gate) {
      try {
        const g = JSON.parse(firstJson(gate.text)) as { ask?: boolean; questions?: string[] }
        ask = g.ask === true
        gateQuestions = Array.isArray(g.questions) ? g.questions.filter((q) => typeof q === 'string' && q.trim()).map((q) => q.trim()).slice(0, 3) : []
        // ПРОВЕРКА ЯЗЫКА КОДОМ. Просьба «пиши на языке запроса» адресована быстрой модели —
        // той самой, про которую известно, что она роняет именно эту задачу. Опросник на
        // чужом языке хуже, чем его отсутствие: он выглядит поломкой, а не заботой. Поэтому
        // при несовпадении просто идём в совет без беседы.
        // Правило слабее, чем «определённый язык совпал», и это НАМЕРЕННО: у русского
        // технического опросника («Стек? | Node.js | Python | Docker») латиница по долям
        // символов побеждает, и строгая проверка отрезала бы беседу ровно там, где она нужнее
        // всего — у недоопределённых технических запросов (находка ревью). Поэтому судим по
        // ПРИСУТСТВИЮ письменности: для русского хватает кириллицы где угодно в опроснике.
        const asked = gateQuestions.join(' ')
        const hasCyrillic = /[а-яА-Я]/.test(asked)
        const wrongLanguage = lang === 'ru' ? !hasCyrillic : hasCyrillic
        if (gateQuestions.length && wrongLanguage) {
          gateQuestions = []
        }
      } catch { /* не распарсили — идём как обычно */ }
    }
    if (ask && gateQuestions.length) {
      emit('plan', vl('reporter', 'clarify') ?? t('ai.theRequestBroadCouple', lang), 'reporter', t('common.reporter', lang))
      return { clarify: gateQuestions }
    }
  }

  // 1) Распорядитель: глубина (single|council) + созыв экспертов по домену (адаптивная глубина = лимит цены).
  const roster = EXPERTS.map((e) => `${e.id}: ${e.persona} [${e.domains.join(',')}]`).join('\n')
  // «kind» распорядитель решает тем же дешёвым вызовом, что и глубину/состав — стоит ~0. Это LLM-слой
  // классификации типа списка (ADR-0010) поверх грамматического дефолта classifyListKind (fallback ниже).
  const kindField = `"kind":"procedure|inventory|checklist|criteria|options"`
  const jsonShape = `{"depth":"single|council",${kindField},"summon":["id",...],"reason":"short"}`
  const steward = await run(
    fast,
    `You are the steward of a panel of domain experts building a reference list. Choose process depth, the LIST KIND, and summon experts.
- depth "single": the topic is clear AND simple/everyday (chores, basic personal routines) — no council needed.
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
  let depth: 'single' | 'council' = 'council'
  let ids: string[] = []
  // opts.kind (выбор пользователя-переключателя) — ЖЁСТКИЙ: распорядитель его не трогает.
  // Иначе — грамматический дефолт, а распорядитель уточняет своим LLM-решением, если оно валидно.
  const kindForced = Boolean(opts.kind)
  let kind: ListKind = opts.kind ?? classifyListKind(query)
  if (steward) {
    try {
      const p = JSON.parse(firstJson(steward.text)) as { depth?: string; kind?: string; summon?: string[] }
      if (p.depth === 'single') depth = 'single'
      if (!kindForced && p.kind && (LIST_KINDS as string[]).includes(p.kind)) kind = p.kind as ListKind
      ids = Array.isArray(p.summon) ? p.summon : []
    } catch { /* дефолт council */ }
  }

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

  // KPI-петля (HQ §6, слой «репутация»): при ПРОЧИХ РАВНЫХ предпочитаем гномов с
  // лучшим послужным списком (доля принятых людьми). Влияет только на ВЫБОР среди
  // кандидатов — не на то, кого вообще можно позвать: домен решает стюард. Так
  // «признание практикой» замыкается в поведение, а не только в бейдж.
  const rep = await gnomeReputation()
  // 2) Созыв: эксперты по домену; пол разнообразия — минимум 2 независимых мнения (мудрость толпы).
  // Стюард мог назвать больше maxGnomes — оставляем не первых попавшихся, а самых уважаемых.
  const summoned = ids.map((id) => EXPERTS.find((e) => e.id === id)).filter((e): e is Expert => Boolean(e))
  const experts = [...summoned].sort((a, b) => repScore(rep, b.id) - repScore(rep, a.id)).slice(0, maxGnomes)
  // Добор до 2 — из ТОГО, ЧТО ВКЛЮЧЕНО (EXPERTS уже отфильтрован по enabled). Раньше здесь стоял
  // EXPERTS.find(...)! по хардкоду 'generalist'/'hoarder' — админ выключил универсала в зале совета,
  // и вся джоба падала (TypeError вне try → вечный pending). Универсал/барахольщик приоритетны как
  // дефолт-на-любую-тему; среди прочих равных — по репутации.
  const padOrder = [...EXPERTS].sort((a, b) => {
    const rank = (e: Expert) => (e.id === 'generalist' ? 0 : e.id === 'hoarder' ? 1 : 2)
    return rank(a) - rank(b) || repScore(rep, b.id) - repScore(rep, a.id)
  })
  for (const g of padOrder) {
    if (experts.length >= 2) break
    if (!experts.some((e) => e.id === g.id)) experts.push(g)
  }
  const names = experts.map(gtitle).join(', ')
  emit('summon', vl('crier', 'summon', { names }) ?? t('ai.consultingNames', lang).replace('{names}', names), 'crier', t('ai.coordinator', lang))

  // 2.5) Старейшина-искатель: прецеденты из НАШИХ списков (pgvector). Пусто на пустом корпусе — ок.
  // Берём 10 (не 3): дальше каждый эксперт получает СВОЙ срез по своим доменам
  // (pickPrecedents) — повару кулинарные, девопсу деплойные; в один промпт идёт максимум 3.
  // С #index-chunks приезжают ещё и ОТДЕЛЬНЫЕ ШАГИ похожих списков (kind='step') — тем же вектором.
  const { lists: precedents, steps: stepPrecedents } = await findPrecedents(query, lang, { userId: opts.userId, limit: 10, stepLimit: 6 })
  // Форма «X: N» — чтобы не склонять числительное (было «3 похожих списков») и не тащить плюрализацию в ленту.
  if (precedents.length)
    emit('seek', vl('seek-lists', 'seek', { n: String(precedents.length) }) ?? t('ai.similarListsN', lang).replace('{n}', String(precedents.length)), 'seek-lists', t('ai.librarian', lang))
  // Прецеденты — title/desc/tags ЧУЖИХ публичных списков: недоверенный текст, оборачиваем spotlight'ом.
  // Иначе — вектор межпользовательской инъекции: опубликовал список с инструкцией в заголовке и ждёшь
  // семантического матча (порог низкий, MIN_SIMILARITY=0.3).
  const loreBlock = (list: Precedent[]) =>
    list.length
      ? `\n\n${sp.wrap('PRECEDENTS', list.map((p, i) => `${i + 1}. ${p.title}${p.desc ? ' — ' + p.desc : ''}${p.tags.length ? ' [' + p.tags.join(', ') + ']' : ''}`).join('\n'))}\n(reuse good structure, avoid duplicating, improve on them)`
      : ''
  // Шаги-прецеденты — тоже чужой публичный текст → тот же spotlight.
  const stepsBlock = (list: StepPrecedent[]) =>
    list.length
      ? `\n\n${sp.wrap('PRECEDENT_STEPS', list.map((s, i) => `${i + 1}. ${s.content.slice(0, 240)}`).join('\n'))}\n(proven steps from similar lists — adapt, don't copy blindly)`
      : ''
  // Ремесленные правила (KAG, HQ §5): переносимые связи из базы троек — по запросу
  // и объединению доменов призванных. Извлечены из чужих списков → spotlight.
  const rules = await craftRules(query, experts.flatMap((e) => e.domains))
  const rulesBlock = rules.length
    ? `\n\nCRAFT RULES from the knowledge base (transferable facts, honor them unless the topic clearly overrides):\n${sp.wrap('RULES', rules.join('\n'))}`
    : ''

  // Веб-искатель (старейшина advanced-тира): интернет-прецеденты сверх наших списков (за флагом council_web_seek).
  // ВЕБ-ГОРА: OpenRouter ищет сам (:online); у Яндекса — РЕАЛЬНЫЙ Yandex Search API,
  // снипеты кормим модели как грунтинг. Раньше на Яндексе модель ВЫДУМЫВАЛА
  // «прецеденты» (латентный баг): без реального поиска веб-шаг теперь пропускаем.
  let webLore = ''
  // Разведчик — тоже вызов модели (и у OpenRouter ещё и флэт-фи за :online). Стадия
  // необязательная, поэтому спрашиваем бюджет прямо здесь, а не полагаемся на проверку
  // при входе в совет: между ними уже прошли gate и распорядитель (линза 03, №3).
  if (settings.councilWebSeek && (await globalBudgetOk())) {
    if (isOpenRouter) {
      emit('seek', vl('seek-web', 'seek') ?? t('ai.searchingWebPrecedents', lang), 'seek-web', t('ai.webScout', lang))
      const webSys = `You are a knowledgeable researcher with web access. Find 3-5 concise, REAL precedents/analogies for building a list on this topic: how it is typically done, common pitfalls, authoritative approaches. Short bullet list in ${langName}. Return ONLY the bullets.\n${sp.rule()}`
      const webRes = await run(online(fast, true), webSys, `Topic:\n${topic}`, 500)
      // Содержимое чужих веб-страниц — тоже недоверенный текст: оборачиваем, не вставляем сырьём.
      if (webRes && webRes.text.trim()) webLore = `\n\n${sp.wrap('WEB_PRECEDENTS', webRes.text.trim())}\n(verify, don't copy blindly)`
    } else {
      const { webSearch } = await import('./web-search')
      const hits = await webSearch(query, lang, 5)
      if (hits && hits.length) {
        emit('seek', vl('seek-web', 'seek') ?? t('ai.searchingWebPrecedents', lang), 'seek-web', t('ai.webScout', lang))
        const bullets = hits.map((h) => `- ${h.title}: ${h.snippet} (${h.url})`).join('\n')
        webLore = `\n\n${sp.wrap('WEB_PRECEDENTS', bullets)}\n(real search results — verify, don't copy blindly)`
      }
      // нет ключа поиска или пусто → веб-шаг молча пропущен (не выдумываем)
    }
  }

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
