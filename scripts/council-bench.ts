/**
 * council-bench.ts — замер «прожорливости гномов» (Совет гномов, research 2026-07-13).
 *
 * Сравнивает на РЕАЛЬНЫХ SetFork-промптах генерации списка три конфигурации:
 *   SINGLE  — один гном (как сейчас в проде: 1 вызов дешёвой модели)
 *   COUNCIL — ручной совет-3: 3 гетерогенных «гнома» набрасывают параллельно → 1 «старейшина» синтезирует (MoA 2-layer / llm-council-lite)
 *   FUSION  — нативный openrouter/fusion (совет на стороне OpenRouter)
 * По каждой конфигурации × промпту пишет: input/output токены, реальный costUsd
 * (providerMetadata.openrouter.usage.cost), латентность. Затем слепой LLM-судья ранжирует три
 * финальных списка по полноте/точности/практичности — ответ на «лучше ли совет одиночки».
 *
 * ВАЖНО: скрипт автономный (НЕ импортит server-only-модули shared/ai), но верен продукту —
 * тот же `ai` SDK + @openrouter/ai-sdk-provider и то же поле usage.cost, что и runListModel/extractUsage.
 *
 * Запуск (из setfork-frontend):
 *   npx tsx scripts/council-bench.ts prices   # только цены каталога — ~0 трат
 *   npx tsx scripts/council-bench.ts live      # живой прогон — небольшие траты (жёсткий кап ниже)
 */
import 'dotenv/config'
import { config as dotenvConfig } from 'dotenv'
import { generateText } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// .env.local имеет приоритет над .env (как в Next).
dotenvConfig({ path: resolve(process.cwd(), '.env') })
dotenvConfig({ path: resolve(process.cwd(), '.env.local'), override: true })

const API_KEY = (process.env.OPENROUTER_API_KEY || '').trim()
const BASE = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1'
const HARD_CAP_USD = 1.5 // страховка: прекращаем вызовы, если суммарный расход превысил кап
const TEMPERATURE = 0.3 // как дефолт продукта (getAiSettings)
const MAX_TOKENS = 1500 // как дефолт продукта

// Гетерогенный ростер «гномов» (разные семейства). Из каталога берём только реально доступные и дешёвые.
const PREFERRED = [
  'openai/gpt-4o-mini',
  'google/gemini-flash-1.5',
  'google/gemini-2.0-flash-001',
  'mistralai/mistral-small',
  'mistralai/mistral-nemo',
  'meta-llama/llama-3.3-70b-instruct',
  'deepseek/deepseek-chat',
  'qwen/qwen-2.5-72b-instruct',
]
const family = (id: string) => id.split('/')[0]

// Реальные SetFork-топики: тех + не-тех (продукт покрывает оба регистра).
const PROMPTS = [
  'Deploy a Next.js app to production with zero downtime',
  'Plan a 3-day solo trip to Kyoto on a budget',
  'Set up observability for a Rust microservice',
]

// Компактный аналог продуктового system-промпта (JSON_SHAPE из shared/ai/generate.ts).
const JSON_SHAPE = `Return ONLY valid JSON (no markdown fences), exactly this shape:
{"title": string, "desc": string, "tags": string[], "items": [{"title": string, "desc": string, "command": string, "level": "required"|"recommended"|"optional", "why": string, "subtasks": string[], "refs": [{"label": string, "url": string}]}]}
Rules: title = concise noun phrase; desc = one sentence; tags = 3-6 short lowercase; items = 4-12 ordered steps (title = short imperative, desc = 1-2 sentences); command = a real runnable terminal command ONLY for technical steps, else ""; refs = 0-3 https links; level = required|recommended|optional; why = one short sentence; subtasks = 0-3 checks.`
const SYS_GEN = `You generate a canonical, high-quality reference checklist as STRICT JSON. All content in English.\n${JSON_SHAPE}\n- Be accurate and practical.`

interface ModelPrice { id: string; name: string; prompt: number; completion: number } // USD / 1M
interface CallStat { model: string; input: number; output: number; cost: number; ms: number; text: string }

let spentUsd = 0
const openrouter = createOpenRouter({ apiKey: API_KEY, appName: 'SetFork-bench', appUrl: 'http://localhost:3000' })

function extractUsage(result: {
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  providerMetadata?: Record<string, unknown>
}): { input: number; output: number; cost: number } {
  const or = (result.providerMetadata?.openrouter as { usage?: { promptTokens?: number; completionTokens?: number; cost?: number } } | undefined)?.usage
  const input = or?.promptTokens ?? result.usage?.inputTokens ?? 0
  const output = or?.completionTokens ?? result.usage?.outputTokens ?? 0
  const cost = typeof or?.cost === 'number' ? or.cost : 0
  return { input, output, cost }
}

async function call(model: string, system: string, prompt: string, maxTokens = MAX_TOKENS): Promise<CallStat> {
  if (spentUsd > HARD_CAP_USD) throw new Error(`HARD_CAP $${HARD_CAP_USD} exceeded (spent $${spentUsd.toFixed(4)})`)
  const t0 = Date.now()
  const result = await generateText({
    model: openrouter.chat(model, { usage: { include: true } }),
    system,
    prompt,
    temperature: TEMPERATURE,
    maxOutputTokens: maxTokens,
  })
  const u = extractUsage(result)
  spentUsd += u.cost
  return { model, input: u.input, output: u.output, cost: u.cost, ms: Date.now() - t0, text: result.text }
}

async function fetchCatalog(): Promise<ModelPrice[]> {
  const res = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${API_KEY}` } })
  if (!res.ok) throw new Error(`/models ${res.status}`)
  const data = (await res.json()) as { data?: Array<{ id: string; name?: string; pricing?: { prompt?: string; completion?: string } }> }
  return (data.data ?? []).map((m) => ({
    id: m.id,
    name: m.name || m.id,
    prompt: (Number(m.pricing?.prompt) || 0) * 1_000_000,
    completion: (Number(m.pricing?.completion) || 0) * 1_000_000,
  }))
}

/** Выбор ростера: из каталога — доступные PREFERRED, дешёвые, по одному на семейство. */
function pickRoster(catalog: ModelPrice[]): { single: ModelPrice; council: ModelPrice[]; aggregator: ModelPrice; judge: ModelPrice } {
  const byId = new Map(catalog.map((m) => [m.id, m]))
  const available = PREFERRED.map((id) => byId.get(id)).filter((m): m is ModelPrice => Boolean(m))
  if (available.length < 3) throw new Error(`ростер < 3 доступных моделей (нашлось ${available.length}). Проверь PREFERRED против каталога (mode=prices).`)
  const seen = new Set<string>()
  const council: ModelPrice[] = []
  for (const m of available) {
    if (seen.has(family(m.id))) continue
    seen.add(family(m.id))
    council.push(m)
    if (council.length === 3) break
  }
  const single = council.slice().sort((a, b) => a.completion - b.completion)[0] // самый дешёвый как одиночка-baseline
  const aggregator = byId.get('openai/gpt-4o-mini') ?? council[0]
  // Судья — НЕ из совета/агрегатора (иначе судит собственный синтез). Берём капабельного из другого семейства.
  const councilFams = new Set([...council.map((m) => family(m.id)), family(aggregator.id)])
  const JUDGE_PREFS = ['anthropic/claude-3.5-haiku', 'anthropic/claude-3-5-haiku', 'deepseek/deepseek-chat', 'google/gemini-2.0-flash-001', 'qwen/qwen-2.5-72b-instruct']
  const judge =
    JUDGE_PREFS.map((id) => byId.get(id)).find((m): m is ModelPrice => Boolean(m) && !councilFams.has(family(m!.id))) ??
    catalog.filter((m) => m.completion > 0 && m.completion <= 2 && !councilFams.has(family(m.id))).sort((a, b) => a.completion - b.completion)[0] ??
    aggregator
  return { single, council, aggregator, judge }
}

function firstJson(text: string): string {
  const s = text.indexOf('{')
  const e = text.lastIndexOf('}')
  return s >= 0 && e > s ? text.slice(s, e + 1) : text
}

async function runCouncil(council: ModelPrice[], aggregator: ModelPrice, prompt: string): Promise<{ calls: CallStat[]; final: string }> {
  // Слой 1: 3 гнома набрасывают параллельно.
  const drafts = await Promise.all(council.map((m) => call(m.id, SYS_GEN, `Create the reference checklist for the topic below.\nTOPIC: ${prompt}`)))
  // Слой 2 (синтез): старейшина сводит анонимизированные черновики в один список.
  const anon = drafts.map((d, i) => `--- DRAFT ${String.fromCharCode(65 + i)} ---\n${firstJson(d.text)}`).join('\n\n')
  const synthSys = `You are the chairman of a council. You are given several draft checklists (JSON) for the same topic. Synthesize the single best checklist: merge the strongest, most accurate and complete steps, drop weak/duplicate ones. Output STRICT JSON only.\n${JSON_SHAPE}`
  const synth = await call(aggregator.id, synthSys, `TOPIC: ${prompt}\n\nDRAFTS:\n${anon}\n\nReturn the synthesized checklist as JSON.`)
  return { calls: [...drafts, synth], final: synth.text }
}

const FUSION_SOFT_CAP_USD = 1.0 // если уже потрачено больше — fusion пропускаем (он потенциально дорогой в Quality-пресете)

async function runFusion(prompt: string): Promise<{ calls: CallStat[]; final: string } | null> {
  if (spentUsd > FUSION_SOFT_CAP_USD) {
    console.warn(`  ~ fusion пропущен (уже потрачено $${spentUsd.toFixed(4)} > soft-cap $${FUSION_SOFT_CAP_USD})`)
    return null
  }
  try {
    // Просим Budget-пресет (дешёвая панель); если поле не поддержано — OpenRouter его проигнорирует.
    const t0 = Date.now()
    const result = await generateText({
      model: openrouter.chat('openrouter/fusion', { usage: { include: true }, extraBody: { preset: 'budget' } }),
      system: SYS_GEN,
      prompt: `Create the reference checklist for the topic below.\nTOPIC: ${prompt}`,
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_TOKENS,
    })
    const u = extractUsage(result)
    spentUsd += u.cost
    const c: CallStat = { model: 'openrouter/fusion', input: u.input, output: u.output, cost: u.cost, ms: Date.now() - t0, text: result.text }
    return { calls: [c], final: c.text }
  } catch (e) {
    console.warn(`  ! fusion недоступен: ${e instanceof Error ? e.message : e}`)
    return null
  }
}

async function judgeRank(judge: ModelPrice, prompt: string, entries: Array<{ tag: string; text: string }>): Promise<string> {
  // Слепая нумерация A/B/C… — судья не видит, какая конфигурация где.
  const labeled = entries.map((e, i) => ({ label: String.fromCharCode(65 + i), ...e }))
  const blob = labeled.map((e) => `=== ${e.label} ===\n${firstJson(e.text).slice(0, 4000)}`).join('\n\n')
  const sys = `You are a strict evaluator of reference checklists. Rank the candidates for the given topic by overall quality: completeness, accuracy, practicality, correct use of the "command" field. Output JSON only: {"ranking": ["A","B",...] (best first), "reason": "one short sentence"}.`
  const r = await call(judge.id, sys, `TOPIC: ${prompt}\n\nCANDIDATES:\n${blob}`, 300)
  // Возвращаем и вердикт судьи, и карту меток→конфигурации (для расшифровки в отчёте).
  const legend = labeled.map((e) => `${e.label}=${e.tag}`).join(', ')
  return `${firstJson(r.text)}  [legend: ${legend}]`
}

function fmtUsd(n: number) { return `$${n.toFixed(6)}` }

async function modePrices() {
  const catalog = await fetchCatalog()
  console.log(`Каталог OpenRouter: ${catalog.length} моделей. Ключ: ${API_KEY ? 'есть' : 'НЕТ'}\n`)
  const { single, council, aggregator, judge } = pickRoster(catalog)
  console.log('Ростер (авто-выбор из доступных PREFERRED):')
  console.log(`  SINGLE (baseline): ${single.id}`)
  console.log(`  COUNCIL-3:         ${council.map((m) => m.id).join(', ')}`)
  console.log(`  AGGREGATOR:        ${aggregator.id}`)
  console.log(`  JUDGE:             ${judge.id}\n`)
  console.log('Цены (USD / 1M токенов):')
  console.log('  model'.padEnd(42), 'prompt'.padStart(10), 'completion'.padStart(12))
  for (const m of [...council, aggregator, judge].filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i)) {
    console.log(' ', m.id.padEnd(40), m.prompt.toFixed(3).padStart(10), m.completion.toFixed(3).padStart(12))
  }
  const fusion = catalog.find((m) => m.id === 'openrouter/fusion')
  console.log(`\n  openrouter/fusion в каталоге: ${fusion ? `есть (prompt ${fusion.prompt.toFixed(3)}, completion ${fusion.completion.toFixed(3)})` : 'НЕ найден (проверить доступность на ключе)'}`)
}

async function modeLive() {
  const catalog = await fetchCatalog()
  const { single, council, aggregator, judge } = pickRoster(catalog)
  console.log(`Ростер: SINGLE=${single.id} | COUNCIL=${council.map((m) => m.id).join('+')} | AGG=${aggregator.id} | JUDGE=${judge.id}`)
  console.log(`Жёсткий кап: $${HARD_CAP_USD}\n`)

  const results: Record<string, unknown>[] = []
  for (const prompt of PROMPTS) {
    console.log(`\n### ${prompt}`)
    const row: Record<string, { cost: number; input: number; output: number; ms: number; calls: number }> = {}

    const s = await call(single.id, SYS_GEN, `Create the reference checklist for the topic below.\nTOPIC: ${prompt}`)
    row.SINGLE = { cost: s.cost, input: s.input, output: s.output, ms: s.ms, calls: 1 }
    console.log(`  SINGLE  ${fmtUsd(s.cost)}  in=${s.input} out=${s.output}  ${s.ms}ms`)

    const cRun = await runCouncil(council, aggregator, prompt)
    const cCost = cRun.calls.reduce((a, c) => a + c.cost, 0)
    const cIn = cRun.calls.reduce((a, c) => a + c.input, 0)
    const cOut = cRun.calls.reduce((a, c) => a + c.output, 0)
    const cMs = cRun.calls.reduce((a, c) => a + c.ms, 0) // последовательный верх-предел; параллельный слой-1 быстрее
    row.COUNCIL = { cost: cCost, input: cIn, output: cOut, ms: cMs, calls: cRun.calls.length }
    console.log(`  COUNCIL ${fmtUsd(cCost)}  in=${cIn} out=${cOut}  ~${cMs}ms  (${cRun.calls.length} вызовов)  ×${(cCost / (s.cost || 1e-9)).toFixed(1)} к SINGLE`)

    const fRun = await runFusion(prompt)
    let fFinal = ''
    if (fRun) {
      const fCost = fRun.calls.reduce((a, c) => a + c.cost, 0)
      row.FUSION = { cost: fCost, input: fRun.calls[0].input, output: fRun.calls[0].output, ms: fRun.calls[0].ms, calls: 1 }
      fFinal = fRun.final
      console.log(`  FUSION  ${fmtUsd(fCost)}  in=${fRun.calls[0].input} out=${fRun.calls[0].output}  ${fRun.calls[0].ms}ms  ×${(fCost / (s.cost || 1e-9)).toFixed(1)} к SINGLE`)
    }

    const entries = [{ tag: 'SINGLE', text: s.text }, { tag: 'COUNCIL', text: cRun.final }]
    if (fFinal) entries.push({ tag: 'FUSION', text: fFinal })
    const verdict = await judgeRank(judge, prompt, entries)
    console.log(`  JUDGE:  ${verdict}`)
    results.push({ prompt, ...row, verdict })
  }

  console.log(`\n=== ИТОГО потрачено: ${fmtUsd(spentUsd)} ===`)
  const out = resolve(process.cwd(), 'scripts', 'council-bench-result.json')
  writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), spentUsd, results }, null, 2))
  console.log(`JSON выгружен: ${out}`)
}

function costOf(prompt: number, completion: number, inTok: number, outTok: number) {
  return (inTok / 1_000_000) * prompt + (outTok / 1_000_000) * completion
}

/** Аналитическая прожорливость: множитель N гномов × R раундов из реальных цен каталога + токенов из live. */
async function modeAnalytic() {
  const catalog = await fetchCatalog()
  const { single, council, aggregator } = pickRoster(catalog)
  const P = 240, L = 1100 // из live-замеров: input≈240, output≈1100 (avg по 3 топикам)
  const meanP = council.reduce((a, m) => a + m.prompt, 0) / council.length
  const meanC = council.reduce((a, m) => a + m.completion, 0) / council.length
  const gnome = (i: number) => council[i] ?? { prompt: meanP, completion: meanC } // N>совета → «средний гном»

  // Совет: слой-1 propose (N гномов) → слои 2..R refine (каждый видит N черновиков) → синтез (agg видит N черновиков).
  function councilCost(N: number, R: number) {
    let total = 0
    for (let i = 0; i < N; i++) total += costOf(gnome(i).prompt, gnome(i).completion, P, L)
    for (let r = 2; r <= R; r++) for (let i = 0; i < N; i++) total += costOf(gnome(i).prompt, gnome(i).completion, P + N * L, L)
    total += costOf(aggregator.prompt, aggregator.completion, P + N * L, L)
    return total
  }

  const base1 = costOf(single.prompt, single.completion, P, L)        // одиночка = самая дешёвая (mistral-nemo)
  const baseMid = costOf(aggregator.prompt, aggregator.completion, P, L) // одиночка = gpt-4o-mini (честнее «против сильной»)
  console.log(`Токен-модель: prompt=${P}, output=${L} (из live). Одиночка-cheapest=${single.id}, одиночка-mid=${aggregator.id}\n`)
  console.log('config'.padEnd(22), 'cost$'.padStart(12), '×cheapest'.padStart(11), '×mid'.padStart(8), 'calls'.padStart(7))
  const rows: Array<[string, number, number]> = [
    ['1 гном (cheapest)', base1, 1],
    ['1 гном (gpt-4o-mini)', baseMid, 1],
    ['совет-3 × 1 раунд', councilCost(3, 1), 4],
    ['совет-3 × 2 раунда', councilCost(3, 2), 7],
    ['совет-5 × 1 раунд', councilCost(5, 1), 6],
    ['совет-5 × 2 раунда', councilCost(5, 2), 11],
  ]
  for (const [name, cost, calls] of rows) {
    console.log(name.padEnd(22), `$${cost.toFixed(6)}`.padStart(12), `×${(cost / base1).toFixed(1)}`.padStart(11), `×${(cost / baseMid).toFixed(1)}`.padStart(8), String(calls).padStart(7))
  }
  console.log(`\nСверка с live: совет-3×1раунд аналитика = $${councilCost(3, 1).toFixed(6)} vs измерено ~$0.0017 (сходится по порядку).`)
}

async function main() {
  if (!API_KEY) {
    console.error('Нет OPENROUTER_API_KEY (проверь .env.local / .env в setfork-frontend).')
    process.exit(1)
  }
  const mode = process.argv[2] || 'prices'
  if (mode === 'prices') await modePrices()
  else if (mode === 'analytic') await modeAnalytic()
  else if (mode === 'live') await modeLive()
  else { console.error(`неизвестный режим "${mode}" (ожидается prices|analytic|live)`); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) })
