/**
 * gnome-society.ts — рабочий оркестратор «Общества гномов» (SetFork, research 2026-07-13).
 *
 * Реализует полный протокол из [[research/2026-07-13-gnome-society-roles]]:
 *   1. КРИКУН-ЗОВУН (router)   — классифицирует домен темы и СОЗЫВАЕТ минимально нужных экспертов
 *                               (это же — рычаг цены: не «всегда N гномов», а sparse-активация).
 *   2. ЭКСПЕРТЫ (factory)      — из ростера-спек инстанцируются гномы-специалисты (повар/девопсер/
 *                               барахольщик…), гетерогенные модели, набрасывают НЕЗАВИСИМО и параллельно
 *                               (мудрость толпы: независимость до обсуждения → анти-стадность).
 *   3. КРИТИК/АДВОКАТ ДЬЯВОЛА  — обязательная оппозиция (Janis: +33-34% качества), анонимный разбор.
 *   4. СТАРЕЙШИНА              — recall-аналогий (Generative-Agents-стиль; полноценный RAG — прод-хук)
 *                               + синтез тезис+антитезис → финальный строгий SetFork-JSON (роль финишера свёрнута).
 *
 * Автономный (НЕ импортит server-only shared/ai), но верен проду: тот же `ai` SDK +
 * @openrouter/ai-sdk-provider и то же поле стоимости providerMetadata.openrouter.usage.cost.
 *
 * Запуск (из setfork-frontend):
 *   npx tsx scripts/gnome-society.ts run "Deploy a Next.js app to production with zero downtime"
 *   npx tsx scripts/gnome-society.ts compare     # society vs плоский совет-3 vs одиночка + судья
 */
import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { generateText } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

dotenvConfig({ path: resolve(process.cwd(), '.env') })
dotenvConfig({ path: resolve(process.cwd(), '.env.local'), override: true })

const API_KEY = (process.env.OPENROUTER_API_KEY || '').trim()
const BASE = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1'
const HARD_CAP_USD = 1.0
const TEMPERATURE = 0.4
const MAX_TOKENS = 1500
const MAX_EXPERTS = 3 // «макс гномов»: крикун созывает не больше стольких экспертов

const openrouter = createOpenRouter({ apiKey: API_KEY, appName: 'SetFork-society', appUrl: 'http://localhost:3000' })
let spentUsd = 0

// ── Строгая форма SetFork-списка (как JSON_SHAPE в shared/ai/generate.ts) ─────────────
const JSON_SHAPE = `Return ONLY valid JSON (no markdown fences), exactly this shape:
{"title": string, "desc": string, "tags": string[], "items": [{"title": string, "desc": string, "command": string, "level": "required"|"recommended"|"optional", "why": string, "subtasks": string[], "refs": [{"label": string, "url": string}]}]}
Rules: title = concise noun phrase; desc = one sentence; tags = 3-6 short lowercase; items = 4-12 ordered steps; command = real runnable terminal command ONLY for technical steps, else ""; refs = 0-3 https links; level = required|recommended|optional; why = one short sentence; subtasks = 0-3 checks. All content in English.`

// ── РОСТЕР-ФАБРИКА: спеки ролей. Гном инстанцируется из спеки (не пишется руками). ────
interface GnomeSpec {
  id: string
  name: string
  emoji: string
  models: string[] // предпочтения (гетерогенность); резолвятся против каталога
  domains: string[] // для крикуна: когда звать
  online?: boolean // web-search (:online) — для барахольщика
  persona: string // system-роль
}
const cheapFallback = 'openai/gpt-4o-mini'

const EXPERTS: GnomeSpec[] = [
  { id: 'devops', name: 'Гном-Девопсер', emoji: '🛠️', models: ['meta-llama/llama-3.3-70b-instruct'], domains: ['deploy', 'devops', 'ci/cd', 'servers', 'infra', 'docker', 'kubernetes'], persona: 'народный работяга-девопсер: надёжность, откаты, health-checks, «как в проде реально бывает»' },
  { id: 'coder', name: 'Гном-Кодер', emoji: '💻', models: ['deepseek/deepseek-chat', 'qwen/qwen-2.5-72b-instruct'], domains: ['programming', 'software', 'coding', 'api', 'library', 'framework'], persona: 'дотошный инженер: корректность, edge-cases, точные шаги и команды' },
  { id: 'chef', name: 'Гном-Повар', emoji: '🍳', models: ['mistralai/mistral-nemo'], domains: ['cooking', 'food', 'recipe', 'kitchen', 'baking'], persona: 'быстрый практичный повар: ингредиенты, порядок, тайминги' },
  { id: 'traveler', name: 'Гном-Странник', emoji: '🧭', models: ['google/gemini-flash-1.5', 'google/gemini-2.0-flash-001'], domains: ['travel', 'trip', 'city', 'tourism', 'itinerary'], persona: 'пытливый странник: маршруты, бюджет, что не пропустить' },
  { id: 'coach', name: 'Гном-Тренер', emoji: '🏋️', models: ['mistralai/mistral-nemo'], domains: ['fitness', 'health', 'workout', 'sport', 'nutrition'], persona: 'дисциплинированный тренер: прогрессия, безопасность, регулярность' },
  { id: 'scholar', name: 'Гном-Книжник', emoji: '📖', models: ['openai/gpt-4o-mini'], domains: ['study', 'learning', 'research', 'course', 'exam'], persona: 'вдумчивый книжник: структура знаний, источники, проверка понимания' },
  { id: 'hoarder', name: 'Гном-Барахольщик', emoji: '🎒', models: ['openai/gpt-4o-mini'], domains: ['*'], online: true, persona: 'Resource Investigator: тащит внешние ресурсы/ссылки/инструменты, «а вот было похожее»' },
  { id: 'generalist', name: 'Гном-Универсал', emoji: '🧩', models: ['openai/gpt-4o-mini'], domains: ['*'], persona: 'эрудит-универсал: разумный список на любую тему' },
]

// Постоянные роли (не выбираются по домену).
const CRIER: GnomeSpec = { id: 'crier', name: 'Крикун-Зовун', emoji: '📣', models: ['mistralai/mistral-nemo', 'openai/gpt-4o-mini'], domains: [], persona: 'диспетчер: классифицирует тему и созывает нужных' }
const CRITIC: GnomeSpec = { id: 'critic', name: 'Адвокат Дьявола', emoji: '😈', models: ['openai/gpt-4o-mini'], domains: [], persona: 'дотошный критик: что упущено, что неверно/опасно, что дублируется' }
// ПРИНЦИП ИННОВАЦИЙ (Guilford divergent, Medici-effect, March exploration): гном-Новатор даёт
// НЕОЧЕВИДНЫЙ/кросс-доменный ход при высокой температуре — защита от «серого консенсуса»/semantic collapse.
const INNOVATOR: GnomeSpec = { id: 'innovator', name: 'Гном-Новатор', emoji: '💡', models: ['openai/gpt-4o-mini', 'mistralai/mistral-nemo'], domains: [], persona: 'Plant-новатор: смелые нестандартные ходы, идеи с пересечения разных областей' }
const INNOVATOR_TEMP = 0.9

// ПЛАНИРОВЩИК (адаптивная глубина, System-1/System-2): решает, нужен ли совет вообще.
const PLANNER: GnomeSpec = { id: 'planner', name: 'Гном-Планировщик', emoji: '🧭', models: ['mistralai/mistral-nemo', 'openai/gpt-4o-mini'], domains: [], persona: 'распорядитель: оценивает сложность/ясность задачи и выбирает глубину процесса' }
// РЕПОРТЁР (диалог с пользователем): уточняющие вопросы при неоднозначности + подача результата.
const REPORTER: GnomeSpec = { id: 'reporter', name: 'Гном-Репортёр', emoji: '🗣️', models: ['openai/gpt-4o-mini'], domains: [], persona: 'спикер совета: задаёт уточняющие вопросы и подаёт результат по-человечески' }
const ELDER: GnomeSpec = { id: 'elder', name: 'Старейшина Клодли', emoji: '⚖️', models: ['openai/gpt-4o-mini'], domains: [], persona: 'старейшина-синтезатор: сводит тезис+антитезис в финал' }
// Старейшина-ИСКАТЕЛЬ: работает ПЕРВЫМ шагом. base = RAG по нашим спискам; advanced-поколение = ещё и интернет.
const ELDER_SEEKER: GnomeSpec = { id: 'seeker', name: 'Старейшина-Искатель Ло', emoji: '🔮', models: ['openai/gpt-4o-mini'], domains: [], persona: 'хранитель памяти: находит прецеденты/аналогии, чтобы совет не начинал с нуля' }

/**
 * ПРОД-ХУК: поиск по нашим спискам. В bench корпуса нет — возвращаем метку.
 * В проде: pgvector similarity над таблицей списков (embeddings уже есть в схеме), top-k похожих списков.
 */
async function retrieveOurLists(_topic: string): Promise<string> {
  return '(RAG по спискам SetFork — прод-хук: pgvector similarity над таблицей lists/templates, top-k похожих; в bench-скрипте корпус не подключён)'
}

// ── OpenRouter-машинерия (верна проду) ────────────────────────────────────────────────
interface CallStat { role: string; model: string; input: number; output: number; cost: number; ms: number; text: string }

function extractUsage(r: { usage?: { inputTokens?: number; outputTokens?: number }; providerMetadata?: Record<string, unknown> }) {
  const or = (r.providerMetadata?.openrouter as { usage?: { promptTokens?: number; completionTokens?: number; cost?: number } } | undefined)?.usage
  return {
    input: or?.promptTokens ?? r.usage?.inputTokens ?? 0,
    output: or?.completionTokens ?? r.usage?.outputTokens ?? 0,
    cost: typeof or?.cost === 'number' ? or.cost : 0,
  }
}

async function call(role: string, model: string, system: string, prompt: string, maxTokens = MAX_TOKENS, temp = TEMPERATURE): Promise<CallStat> {
  if (spentUsd > HARD_CAP_USD) throw new Error(`HARD_CAP $${HARD_CAP_USD} exceeded (spent $${spentUsd.toFixed(4)})`)
  const t0 = Date.now()
  const result = await generateText({ model: openrouter.chat(model, { usage: { include: true } }), system, prompt, temperature: temp, maxOutputTokens: maxTokens })
  const u = extractUsage(result)
  spentUsd += u.cost
  return { role, model, input: u.input, output: u.output, cost: u.cost, ms: Date.now() - t0, text: result.text }
}

async function fetchCatalogIds(): Promise<Set<string>> {
  const res = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${API_KEY}` } })
  if (!res.ok) throw new Error(`/models ${res.status}`)
  const data = (await res.json()) as { data?: Array<{ id: string }> }
  return new Set((data.data ?? []).map((m) => m.id))
}
function resolveModel(spec: GnomeSpec, available: Set<string>): string {
  return spec.models.find((m) => available.has(m)) ?? cheapFallback
}
function firstJson(t: string): string {
  const s = t.indexOf('{'), e = t.lastIndexOf('}')
  return s >= 0 && e > s ? t.slice(s, e + 1) : t
}
const usd = (n: number) => `$${n.toFixed(6)}`

// ── КРИКУН-ЗОВУН: классификация + созыв ───────────────────────────────────────────────
async function summon(topic: string, available: Set<string>): Promise<{ call: CallStat; experts: GnomeSpec[]; domain: string; why: string }> {
  const roster = EXPERTS.map((e) => `${e.id}: ${e.name} — домены [${e.domains.join(', ')}]`).join('\n')
  const sys = `Ты крикун-зовун гномьего совета. По теме списка определи домен и созови от 2 до ${MAX_EXPERTS} экспертов из ростера — релевантных теме. Нужно РАЗНООБРАЗИЕ (минимум 2 разных для независимых мнений — мудрость толпы). Обычно добавляй 'hoarder' для внешних ссылок. Верни ТОЛЬКО JSON: {"domain": string, "summon": ["id",...], "why": "одна фраза"}.\n\nРОСТЕР:\n${roster}`
  const c = await call('crier', resolveModel(CRIER, available), sys, `ТЕМА: ${topic}`, 220)
  let ids: string[] = []
  let domain = 'general', why = ''
  try {
    const parsed = JSON.parse(firstJson(c.text)) as { domain?: string; summon?: string[]; why?: string }
    ids = Array.isArray(parsed.summon) ? parsed.summon : []
    domain = parsed.domain || domain
    why = parsed.why || ''
  } catch { /* fallback ниже */ }
  let experts = ids.map((id) => EXPERTS.find((e) => e.id === id)).filter((e): e is GnomeSpec => Boolean(e)).slice(0, MAX_EXPERTS)
  // Пол разнообразия: минимум 2 независимых мнения (мудрость толпы). Добираем барахольщиком/универсалом.
  for (const padId of ['hoarder', 'generalist']) {
    if (experts.length >= 2) break
    const pad = EXPERTS.find((e) => e.id === padId)!
    if (!experts.some((e) => e.id === pad.id)) experts.push(pad)
  }
  return { call: c, experts, domain, why }
}

// ── СТАРЕЙШИНА-ИСКАТЕЛЬ: первоначальный поиск прецедентов (наши списки + интернет для advanced) ──
async function seek(topic: string, available: Set<string>, tier: 'basic' | 'advanced'): Promise<{ call: CallStat; lore: string }> {
  const ourLists = await retrieveOurLists(topic) // прод-хук: RAG по спискам SetFork
  const seekerModel = resolveModel(ELDER_SEEKER, available)
  const model = tier === 'advanced' ? `${seekerModel}:online` : seekerModel // advanced-поколение = ещё и интернет
  const sys = `Ты ${ELDER_SEEKER.name} — ${ELDER_SEEKER.persona}. Твоя задача — дать совету ПРЕЦЕДЕНТЫ и АНАЛОГИИ по теме${tier === 'advanced' ? ' (можешь искать в интернете)' : ''}: как решают похожее, типичные грабли, проверенные подходы. Кратко, 3-6 пунктов. По-русски.`
  const c = await call('seeker', model, sys, `ТЕМА: ${topic}\n\nНАШИ ПОХОЖИЕ СПИСКИ: ${ourLists}`, 500)
  return { call: c, lore: c.text }
}

// ── Полный прогон общества ────────────────────────────────────────────────────────────
async function runSociety(topic: string, available: Set<string>, opts: { tier?: 'basic' | 'advanced'; verbose?: boolean } = {}) {
  const tier = opts.tier ?? 'basic'
  const verbose = opts.verbose ?? true
  const calls: CallStat[] = []
  const t0 = Date.now()

  // 1. Крикун созывает
  const s = await summon(topic, available)
  calls.push(s.call)
  if (verbose) console.log(`\n📣 Крикун созвал (${s.domain}): ${s.experts.map((e) => e.emoji + e.name).join(', ')} — ${s.why}`)

  // 2. Старейшина-искатель ПЕРВЫМ приносит прецеденты (наши списки + интернет)
  const seeker = await seek(topic, available, tier)
  calls.push(seeker.call)
  if (verbose) console.log(`\n🔮 ${ELDER_SEEKER.name} (${seeker.call.model}) — ${usd(seeker.call.cost)}, ${seeker.call.ms}ms:\n${seeker.lore.slice(0, 400)}…`)

  // 3. Эксперты набрасывают НЕЗАВИСИМО (получая прецеденты в контексте) + гном-Новатор (дивергенция) — параллельно
  const loreCtx = `\n\nПРЕЦЕДЕНТЫ ОТ СТАРЕЙШИНЫ (учти):\n${seeker.lore}`
  const draftJobs = s.experts.map((e) => () => {
    const em = resolveModel(e, available)
    const model = e.online ? `${em}:online` : em // барахольщик реально ходит в веб
    const sys = `Ты ${e.name} — ${e.persona}. Набросай практичный чеклист по теме. 6-9 шагов: краткий императив + 1 фраза + (если тех-шаг) реальная команда. Пиши по-русски, по делу. Верни ТОЛЬКО текст черновика.`
    return call(`expert:${e.id}`, model, sys, `ТЕМА: ${topic}${loreCtx}`)
  })
  // Принцип инноваций: новатор при высокой температуре даёт неочевидный/кросс-доменный ход.
  const innovatorJob = () => call('innovator', resolveModel(INNOVATOR, available),
    `Ты ${INNOVATOR.name} — ${INNOVATOR.persona}. Дай СВЕЖИЙ, неочевидный взгляд на список по теме: что упускают все, какой ход с пересечения других областей даёт скачок качества. 4-7 смелых пунктов. По-русски. Верни ТОЛЬКО текст.`,
    `ТЕМА: ${topic}${loreCtx}`, MAX_TOKENS, INNOVATOR_TEMP)
  const pool = await Promise.all([...draftJobs, innovatorJob].map((j) => j()))
  const drafts = pool.slice(0, s.experts.length)
  const innovation = pool[pool.length - 1]
  calls.push(...pool)
  if (verbose) {
    drafts.forEach((d, i) => console.log(`\n${s.experts[i].emoji} ${s.experts[i].name} (${d.model}) — ${usd(d.cost)}, ${d.ms}ms:\n${d.text.slice(0, 300)}…`))
    console.log(`\n💡 ${INNOVATOR.name} (${innovation.model}, temp ${INNOVATOR_TEMP}) — ${usd(innovation.cost)}, ${innovation.ms}ms:\n${innovation.text.slice(0, 350)}…`)
  }

  // 4. Адвокат дьявола (анонимные черновики + инновация)
  const anon = [...drafts, innovation].map((d, i) => `--- ЧЕРНОВИК ${String.fromCharCode(65 + i)} ---\n${d.text}`).join('\n\n')
  const critique = await call('critic', resolveModel(CRITIC, available),
    `Ты ${CRITIC.name} — ${CRITIC.persona}. Тебе дали анонимные черновики чеклиста по одной теме (последний — смелая инновация). Разбери: что упущено, что неверно/опасно, что дублируется, чей шаг сильнее, какая смелая идея реально ценна. По-русски, по пунктам.`,
    `ТЕМА: ${topic}\n\n${anon}`)
  calls.push(critique)
  if (verbose) console.log(`\n😈 ${CRITIC.name} (${critique.model}) — ${usd(critique.cost)}, ${critique.ms}ms:\n${critique.text.slice(0, 400)}…`)

  // 5. Старейшина-синтезатор: конвергенция → строгий SetFork-JSON. СОХРАНИ лучшую новую идею (не усредняй!).
  const elder = await call('elder', resolveModel(ELDER, available),
    `Ты ${ELDER.name} — ${ELDER.persona}. Синтезируй ОДИН лучший чеклист: возьми сильнейшие точные шаги, учти прецеденты и критику, убери слабое/дубли. ВАЖНО (принцип инноваций): СОХРАНИ 1-2 самые ценные НЕОЧЕВИДНЫЕ идеи новатора — не усредняй список до банальности. ${JSON_SHAPE}`,
    `ТЕМА: ${topic}\n\nПРЕЦЕДЕНТЫ:\n${seeker.lore}\n\nЧЕРНОВИКИ:\n${anon}\n\nКРИТИКА:\n${critique.text}\n\nВыдай финальный список как строгий JSON.`)
  calls.push(elder)
  if (verbose) console.log(`\n⚖️ ${ELDER.name} (${elder.model}) — ${usd(elder.cost)}, ${elder.ms}ms → финальный JSON готов.`)

  const totalCost = calls.reduce((a, c) => a + c.cost, 0)
  const wallMs = Date.now() - t0
  return { calls, final: elder.text, summoned: s.experts.map((e) => e.id), tier, totalCost, wallMs, gnomeCount: calls.length }
}

// Плоский совет-3 (без крикуна): 3 фикс-эксперта параллельно → синтез. Для сравнения прожорливости.
async function runFlatCouncil(topic: string, available: Set<string>) {
  const fixed = ['devops', 'coder', 'generalist'].map((id) => EXPERTS.find((e) => e.id === id)!)
  const drafts = await Promise.all(fixed.map((e) => call(`flat:${e.id}`, resolveModel(e, available),
    `Ты ${e.name} — ${e.persona}. Набросай чеклист по теме, 6-9 шагов. По-русски. Верни ТОЛЬКО текст.`, `ТЕМА: ${topic}`)))
  const anon = drafts.map((d, i) => `--- ${String.fromCharCode(65 + i)} ---\n${d.text}`).join('\n\n')
  const synth = await call('flat:synth', resolveModel(ELDER, available), `Синтезируй один лучший чеклист из черновиков. ${JSON_SHAPE}`, `ТЕМА: ${topic}\n\n${anon}`)
  const calls = [...drafts, synth]
  return { calls, final: synth.text, totalCost: calls.reduce((a, c) => a + c.cost, 0), gnomeCount: calls.length }
}

async function runSingle(topic: string, available: Set<string>) {
  const c = await call('single', resolveModel(EXPERTS.find((e) => e.id === 'generalist')!, available),
    `You generate a high-quality reference checklist as STRICT JSON. ${JSON_SHAPE}`, `Create the checklist for: ${topic}`)
  return { calls: [c], final: c.text, totalCost: c.cost, gnomeCount: 1 }
}

async function judge(available: Set<string>, topic: string, entries: Array<{ tag: string; text: string }>) {
  const labeled = entries.map((e, i) => ({ label: String.fromCharCode(65 + i), ...e }))
  const blob = labeled.map((e) => `=== ${e.label} ===\n${firstJson(e.text).slice(0, 3500)}`).join('\n\n')
  // Судья вне ростера-агрегатора, если возможно.
  const jm = ['deepseek/deepseek-chat', 'anthropic/claude-3.5-haiku', 'qwen/qwen-2.5-72b-instruct'].find((m) => available.has(m)) ?? cheapFallback
  const r = await call('judge', jm, `Rank the checklist candidates by quality (completeness, accuracy, practicality, correct use of "command"). Output JSON only: {"ranking":["A",...],"reason":"one sentence"}.`, `TOPIC: ${topic}\n\n${blob}`, 250)
  return `${firstJson(r.text)}  [legend: ${labeled.map((e) => e.label + '=' + e.tag).join(', ')}]`
}

// ── ПЛАНИРОВЩИК: адаптивная глубина (System-1/System-2). «План не важен → сразу список». ──
async function planner(topic: string, available: Set<string>): Promise<{ call: CallStat; mode: 'trivial' | 'standard' | 'ambiguous'; questions: string[]; reason: string }> {
  const sys = `Ты ${PLANNER.name} — ${PLANNER.persona}. Дорого созывать весь совет; созывай ТОЛЬКО когда это правда нужно. Выбери ГЛУБИНУ:
- "trivial" (ПО УМОЛЧАНИЮ для бытовых/простых/личных тем — уборка, привычки, базовые рутины, покупки): совет НЕ нужен → сразу список одним гномом.
- "standard": только если тема ТЕХНИЧЕСКАЯ, профессиональная, с рисками/безопасностью, или явно многогранная/спорная и реально выиграет от экспертов.
- "ambiguous": не хватает ключевого параметра (уровень/бюджет/контекст/цель), без которого список выйдет наугад → сначала уточнить.
Правило: сомневаешься между trivial и standard → выбирай trivial. Верни ТОЛЬКО JSON: {"mode":"trivial|standard|ambiguous","questions":["...до 3, только если ambiguous"],"reason":"одна фраза"}.`
  const c = await call('planner', resolveModel(PLANNER, available), sys, `ЗАПРОС СПИСКА: ${topic}`, 220)
  let mode: 'trivial' | 'standard' | 'ambiguous' = 'standard'
  let questions: string[] = []
  let reason = ''
  try {
    const p = JSON.parse(firstJson(c.text)) as { mode?: string; questions?: string[]; reason?: string }
    if (p.mode === 'trivial' || p.mode === 'ambiguous' || p.mode === 'standard') mode = p.mode
    questions = Array.isArray(p.questions) ? p.questions.slice(0, 3) : []
    reason = p.reason || ''
  } catch { /* default standard */ }
  return { call: c, mode, questions, reason }
}

// ── Режимы ────────────────────────────────────────────────────────────────────────────
const TOPICS = ['Deploy a Next.js app to production with zero downtime', 'Plan a 3-day solo trip to Kyoto on a budget']

async function modeRun(topic: string, tier: 'basic' | 'advanced') {
  const available = await fetchCatalogIds()

  // 0. Планировщик: нужен ли совет вообще? (адаптивная глубина = рычаг цены)
  const plan = await planner(topic, available)
  console.log(`\n🧭 ${PLANNER.name} → режим "${plan.mode}" — ${plan.reason}`)

  let result: { calls: CallStat[]; final: string; totalCost: number; gnomeCount: number; wallMs?: number; summoned?: string[]; mode: string }
  if (plan.mode === 'trivial') {
    // «План не важен → сразу требуемый список» одним гномом.
    console.log('   → тема простая, совет не созываю, генерирую сразу.')
    const one = await runSingle(topic, available)
    result = { ...one, mode: 'trivial' }
  } else {
    if (plan.mode === 'ambiguous' && plan.questions.length) {
      // Репортёр задал бы уточняющие вопросы (в проде — диалог + память сессии; здесь показываем и продолжаем с допущением).
      console.log(`\n🗣️ ${REPORTER.name} уточнил бы у пользователя:`)
      plan.questions.forEach((q, i) => console.log(`   ${i + 1}. ${q}`))
      console.log('   (в прод-режиме тут диалог; в bench продолжаю с разумным допущением)')
    }
    const r = await runSociety(topic, available, { tier, verbose: true })
    result = { ...r, mode: plan.mode }
  }
  result.calls.unshift(plan.call) // учёт планировщика в прожорливости

  const total = result.calls.reduce((a, c) => a + c.cost, 0)
  console.log(`\n=== ИТОГ (${result.mode}${result.mode !== 'trivial' ? ', ' + tier : ''}): ${result.calls.length} вызовов, ${usd(total)} ===`)
  console.log('Финальный список (JSON):\n' + firstJson(result.final).slice(0, 1000))
  const out = resolve(process.cwd(), 'scripts', 'gnome-society-result.json')
  writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), topic, plan: { mode: plan.mode, reason: plan.reason, questions: plan.questions }, ...result, totalCost: total }, null, 2))
  console.log(`\nJSON выгружен: ${out}`)
}

async function modeCompare() {
  const available = await fetchCatalogIds()
  const rows: Record<string, unknown>[] = []
  for (const topic of TOPICS) {
    console.log(`\n### ${topic}`)
    const soc = await runSociety(topic, available, { tier: 'basic', verbose: false })
    const flat = await runFlatCouncil(topic, available)
    const one = await runSingle(topic, available)
    const verdict = await judge(available, topic, [{ tag: 'SOCIETY', text: soc.final }, { tag: 'FLAT', text: flat.final }, { tag: 'SINGLE', text: one.final }])
    console.log(`  SOCIETY  ${usd(soc.totalCost)}  (${soc.gnomeCount} гномов, созыв: ${soc.summoned.join('+')})`)
    console.log(`  FLAT-3   ${usd(flat.totalCost)}  (${flat.gnomeCount} вызовов)`)
    console.log(`  SINGLE   ${usd(one.totalCost)}`)
    console.log(`  JUDGE:   ${verdict}`)
    rows.push({ topic, society: { cost: soc.totalCost, gnomes: soc.gnomeCount, summoned: soc.summoned }, flat: { cost: flat.totalCost }, single: { cost: one.totalCost }, verdict })
  }
  console.log(`\n=== ИТОГО потрачено: ${usd(spentUsd)} ===`)
  const out = resolve(process.cwd(), 'scripts', 'gnome-society-compare.json')
  writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), spentUsd, rows }, null, 2))
  console.log(`JSON выгружен: ${out}`)
}

async function main() {
  if (!API_KEY) { console.error('Нет OPENROUTER_API_KEY (.env.local / .env).'); process.exit(1) }
  const mode = process.argv[2] || 'run'
  const tier = (process.argv[4] as 'basic' | 'advanced') === 'basic' ? 'basic' : 'advanced'
  if (mode === 'run') await modeRun(process.argv[3] || TOPICS[0], tier)
  else if (mode === 'compare') await modeCompare()
  else { console.error(`режим "${mode}" неизвестен (run <topic> [basic|advanced] | compare)`); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) })
