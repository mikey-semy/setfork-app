/* eslint-disable no-restricted-syntax -- CLI-скрипт замера: console-вывод, не UI */
/**
 * ablation-eval.ts — ДОКАЗАТЕЛЬНЫЙ замер трёх заявленных преимуществ SetFork.
 * Цель владельца: превратить веру в числа (вера → факт). Меряем то, что можно
 * измерить ОФФЛАЙН и по возможности ОБЪЕКТИВНО (не только суждением LLM).
 *
 *   A. МУЛЬТИАГЕНТ — совет vs одиночка. Слепой pairwise-судья СО СМЕНОЙ ПОЗИЦИЙ
 *      (митигация position-bias): совет «побеждает» промпт только если выигрывает
 *      в ОБОИХ порядках. Отчёт: win/lose/tie + cost× совета к одиночке.
 *   B. GROUNDING — объективно: доля ВЫДУМАННЫХ URL в НЕ-grounded генерации. Каждый
 *      ref фактически фетчится → % мёртвых. Высокая доля = объективное «зачем нужен
 *      grounding» (продуктовый grounding должен её резко снижать — сверить отдельно
 *      на выводе реального пайплайна).
 *   C. СТРУКТУРА — список vs проза. Судья: чем реально ПРОЙТИ задачу и отметить
 *      прогресс — структурой или прозой? + объективно: число дискретных проверяемых
 *      единиц (шаги+подпроверки) у списка против прозы (~0).
 *
 * ЧЕСТНЫЕ ОГРАНИЧЕНИЯ (печатаются в шапке отчёта):
 *   - LLM-судья предвзят → митигируем сменой позиций + судья из ЧУЖОГО семейства.
 *   - Малое N промптов → это направление/порядок, не p-value. Гонять несколько раз.
 *   - Ось C оффлайн меряет ПРОКСИ (actionability), а НЕ реальную успешность людей —
 *     это требует полевого A/B на пользователях (completion rate прогонов).
 *   - Bench-ростер = РАЗНЫЕ модели (проверка MoA-разнообразия). Продуктовый совет —
 *     персоны на близких моделях: там выигрыш от разнообразия может быть МЕНЬШЕ.
 *     Чтобы измерить именно продукт — прогнать реальный generateListCouncil (TODO,
 *     нужен app-env: DB/квоты).
 *
 * Запуск (из setfork-frontend):
 *   npx tsx scripts/ablation-eval.ts prices   # только каталог/ростер — ~0 трат
 *   npx tsx scripts/ablation-eval.ts live      # живой прогон — траты под жёстким капом
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
const HARD_CAP_USD = 2.0 // страховка: прекращаем вызовы при перерасходе
const TEMPERATURE = 0.3 // как дефолт продукта
const MAX_TOKENS = 1500

// Гетерогенный ростер (разные семейства) — по одному на семейство для совета.
const PREFERRED = [
  'openai/gpt-4o-mini',
  'google/gemini-2.0-flash-001',
  'mistralai/mistral-small',
  'meta-llama/llama-3.3-70b-instruct',
  'deepseek/deepseek-chat',
  'qwen/qwen-2.5-72b-instruct',
]
const family = (id: string) => id.split('/')[0]

// Реальные SetFork-топики: тех (URL/команды осмысленны для оси B) + не-тех.
const PROMPTS = [
  'Deploy a Next.js app to production with zero downtime',
  'Set up observability for a Rust microservice',
  'Harden a fresh Ubuntu server for the public internet',
  'Migrate a Postgres database to a new server safely',
  'Plan a 3-day solo trip to Kyoto on a budget',
  'Onboard a new backend engineer in their first week',
]

const JSON_SHAPE = `Return ONLY valid JSON (no markdown fences), exactly this shape:
{"title": string, "desc": string, "tags": string[], "items": [{"title": string, "desc": string, "command": string, "level": "required"|"recommended"|"optional", "why": string, "subtasks": string[], "refs": [{"label": string, "url": string}]}]}
Rules: items = 4-12 ordered steps; command = a real runnable terminal command ONLY for technical steps else ""; refs = 0-3 real https links; subtasks = 0-3 verification checks.`
const SYS_GEN = `You generate a canonical, high-quality reference checklist as STRICT JSON. English.\n${JSON_SHAPE}\n- Be accurate and practical. For refs, cite REAL canonical documentation URLs.`
const SYS_PROSE = `You are an expert. Explain how to accomplish the task below as a flowing PROSE how-to (2-4 short paragraphs, no bullet lists, no numbered steps, no checkboxes). English. Practical and accurate.`

interface ModelPrice { id: string; name: string; prompt: number; completion: number }
interface CallStat { model: string; input: number; output: number; cost: number; ms: number; text: string }

let spentUsd = 0
const openrouter = createOpenRouter({ apiKey: API_KEY, appName: 'SetFork-ablation', appUrl: 'http://localhost:3000' })

function extractUsage(result: {
  usage?: { inputTokens?: number; outputTokens?: number }
  providerMetadata?: Record<string, unknown>
}): { input: number; output: number; cost: number } {
  const or = (result.providerMetadata?.openrouter as { usage?: { promptTokens?: number; completionTokens?: number; cost?: number } } | undefined)?.usage
  return {
    input: or?.promptTokens ?? result.usage?.inputTokens ?? 0,
    output: or?.completionTokens ?? result.usage?.outputTokens ?? 0,
    cost: typeof or?.cost === 'number' ? or.cost : 0,
  }
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

function pickRoster(catalog: ModelPrice[]): { single: ModelPrice; council: ModelPrice[]; aggregator: ModelPrice; judge: ModelPrice } {
  const byId = new Map(catalog.map((m) => [m.id, m]))
  const available = PREFERRED.map((id) => byId.get(id)).filter((m): m is ModelPrice => Boolean(m))
  if (available.length < 3) throw new Error(`ростер < 3 доступных моделей (${available.length}). Проверь PREFERRED (mode=prices).`)
  const seen = new Set<string>()
  const council: ModelPrice[] = []
  for (const m of available) {
    if (seen.has(family(m.id))) continue
    seen.add(family(m.id))
    council.push(m)
    if (council.length === 3) break
  }
  const single = council.slice().sort((a, b) => a.completion - b.completion)[0]
  const aggregator = byId.get('openai/gpt-4o-mini') ?? council[0]
  const councilFams = new Set([...council.map((m) => family(m.id)), family(aggregator.id)])
  const JUDGE_PREFS = ['anthropic/claude-3.5-haiku', 'anthropic/claude-3-5-haiku', 'google/gemini-2.0-flash-001', 'qwen/qwen-2.5-72b-instruct']
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

// ── Совет (MoA 2-слоя): 3 гнома параллельно → старейшина синтезирует ─────────
async function runCouncil(council: ModelPrice[], aggregator: ModelPrice, prompt: string): Promise<{ cost: number; ms: number; calls: number; final: string }> {
  const drafts = await Promise.all(council.map((m) => call(m.id, SYS_GEN, `Create the reference checklist for the topic.\nTOPIC: ${prompt}`)))
  const anon = drafts.map((d, i) => `--- DRAFT ${String.fromCharCode(65 + i)} ---\n${firstJson(d.text)}`).join('\n\n')
  const synthSys = `You are the chairman of a council. Given several draft checklists (JSON) for one topic, synthesize the single best: merge the strongest, most accurate steps, drop weak/duplicate. STRICT JSON only.\n${JSON_SHAPE}`
  const synth = await call(aggregator.id, synthSys, `TOPIC: ${prompt}\n\nDRAFTS:\n${anon}\n\nReturn the synthesized checklist as JSON.`)
  const all = [...drafts, synth]
  return { cost: all.reduce((a, c) => a + c.cost, 0), ms: all.reduce((a, c) => a + c.ms, 0), calls: all.length, final: synth.text }
}

// ── A: слепой pairwise-судья со сменой позиций ───────────────────────────────
async function judgePair(judge: ModelPrice, prompt: string, x: string, y: string): Promise<'X' | 'Y' | 'tie'> {
  const sys = `You compare two reference checklists (JSON) for the same task. Which is better overall: completeness, accuracy, practicality, correct commands? Output JSON only: {"winner":"A"|"B"|"tie","reason":"one short sentence"}.`
  const r = await call(judge.id, sys, `TASK: ${prompt}\n\n=== A ===\n${firstJson(x).slice(0, 3500)}\n\n=== B ===\n${firstJson(y).slice(0, 3500)}`, 200)
  const w = (JSON.parse(firstJson(r.text)) as { winner?: string }).winner
  return w === 'A' ? 'X' : w === 'B' ? 'Y' : 'tie'
}
/** Совет vs одиночка: судим В ОБА ПОРЯДКА. Победа только при согласии обеих позиций. */
async function pairwiseSwapped(judge: ModelPrice, prompt: string, council: string, single: string): Promise<'council' | 'single' | 'tie'> {
  const [o1, o2] = await Promise.all([judgePair(judge, prompt, council, single), judgePair(judge, prompt, single, council)])
  const a = o1 === 'X' ? 'council' : o1 === 'Y' ? 'single' : 'tie' // порядок 1: X=council
  const b = o2 === 'X' ? 'single' : o2 === 'Y' ? 'council' : 'tie' // порядок 2: X=single
  if (a === b && a !== 'tie') return a
  return 'tie' // несогласие позиций = position-bias → честно ничья
}

// ── B: объективная валидность URL (сколько модель выдумывает) ─────────────────
function extractUrls(json: string): string[] {
  try {
    const o = JSON.parse(firstJson(json)) as { items?: Array<{ refs?: Array<{ url?: string }> }> }
    const urls = (o.items ?? []).flatMap((it) => (it.refs ?? []).map((r) => r.url).filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)))
    return [...new Set(urls)]
  } catch {
    return []
  }
}
async function urlAlive(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'Mozilla/5.0 SetForkAblation' } })
    return res.status < 400
  } catch {
    return false // dns/timeout/reset — недостижим (для оси B считаем «не подтверждён»)
  }
}
async function urlValidity(json: string): Promise<{ total: number; alive: number }> {
  const urls = extractUrls(json)
  const flags = await Promise.all(urls.map(urlAlive))
  return { total: urls.length, alive: flags.filter(Boolean).length }
}

// ── C: список vs проза — судья actionability + объективный счётчик проверок ───
function checkableUnits(json: string): number {
  try {
    const o = JSON.parse(firstJson(json)) as { items?: Array<{ subtasks?: string[] }> }
    const items = o.items ?? []
    return items.length + items.reduce((a, it) => a + (it.subtasks?.length ?? 0), 0)
  } catch {
    return 0
  }
}
async function judgeActionability(judge: ModelPrice, prompt: string, list: string, prose: string): Promise<'list' | 'prose' | 'tie'> {
  const sys = `Two answers explain how to do a task: A and B. Judge ONLY this: which lets a person ACTUALLY EXECUTE the task step by step and TRACK progress (tick off what's done) more reliably? Output JSON only: {"winner":"A"|"B"|"tie"}.`
  // Смена позиций и здесь.
  const p1 = `TASK: ${prompt}\n\n=== A (structured) ===\n${firstJson(list).slice(0, 3000)}\n\n=== B (prose) ===\n${prose.slice(0, 3000)}`
  const p2 = `TASK: ${prompt}\n\n=== A (prose) ===\n${prose.slice(0, 3000)}\n\n=== B (structured) ===\n${firstJson(list).slice(0, 3000)}`
  const [r1, r2] = await Promise.all([call(judge.id, sys, p1, 60), call(judge.id, sys, p2, 60)])
  const w1 = (JSON.parse(firstJson(r1.text)) as { winner?: string }).winner // A=list
  const w2 = (JSON.parse(firstJson(r2.text)) as { winner?: string }).winner // A=prose
  const a = w1 === 'A' ? 'list' : w1 === 'B' ? 'prose' : 'tie'
  const b = w2 === 'A' ? 'prose' : w2 === 'B' ? 'list' : 'tie'
  return a === b && a !== 'tie' ? a : 'tie'
}

function fmtUsd(n: number) { return `$${n.toFixed(6)}` }

async function modePrices() {
  const catalog = await fetchCatalog()
  console.log(`Каталог OpenRouter: ${catalog.length} моделей. Ключ: ${API_KEY ? 'есть' : 'НЕТ'}\n`)
  const { single, council, aggregator, judge } = pickRoster(catalog)
  console.log('Ростер:')
  console.log(`  ОДИНОЧКА (baseline): ${single.id}`)
  console.log(`  СОВЕТ-3:             ${council.map((m) => m.id).join(', ')}`)
  console.log(`  СИНТЕЗ:              ${aggregator.id}`)
  console.log(`  СУДЬЯ (чужое сем.):  ${judge.id}`)
  console.log(`\nПромптов: ${PROMPTS.length}. Прогон 'live' даст числа по осям A/B/C.`)
}

async function modeLive() {
  const catalog = await fetchCatalog()
  const { single, council, aggregator, judge } = pickRoster(catalog)
  console.log('=== АБЛЯЦИОННЫЙ ЗАМЕР SetFork (вера → числа) ===')
  console.log(`Ростер: одиночка=${single.id} | совет=${council.map((m) => m.id).join('+')} | синтез=${aggregator.id} | судья=${judge.id}`)
  console.log('ОГРАНИЧЕНИЯ: судья предвзят (митигация: смена позиций + чужое семейство); малое N=направление, не p-value;')
  console.log('  ось C — прокси actionability, реальная успешность = полевой A/B на людях; bench-ростер разных моделей ≠ продуктовый персона-совет.\n')

  const A = { council: 0, single: 0, tie: 0, costMul: [] as number[] }
  const B = { total: 0, alive: 0 }
  const C = { list: 0, prose: 0, tie: 0, listUnits: [] as number[] }
  const rows: Record<string, unknown>[] = []

  for (const prompt of PROMPTS) {
    console.log(`### ${prompt}`)
    // Генерации: одиночка (JSON), совет (JSON), проза.
    const solo = await call(single.id, SYS_GEN, `Create the reference checklist for the topic.\nTOPIC: ${prompt}`)
    const coun = await runCouncil(council, aggregator, prompt)
    const prose = await call(single.id, SYS_PROSE, `TASK: ${prompt}`)

    // A: совет vs одиночка (та же задача, оба JSON).
    const aWin = await pairwiseSwapped(judge, prompt, coun.final, solo.text)
    A[aWin]++
    const mul = coun.cost / (solo.cost || 1e-9)
    A.costMul.push(mul)

    // B: валидность URL у НЕ-grounded одиночки (объективно).
    const uv = await urlValidity(solo.text)
    B.total += uv.total; B.alive += uv.alive

    // C: список (одиночка JSON) vs проза.
    const cWin = await judgeActionability(judge, prompt, solo.text, prose.text)
    C[cWin]++
    const units = checkableUnits(solo.text)
    C.listUnits.push(units)

    console.log(`  A совет-vs-одиночка: ${aWin.toUpperCase()}  (cost ×${mul.toFixed(1)}: ${fmtUsd(coun.cost)} vs ${fmtUsd(solo.cost)}, ${coun.calls} вызовов)`)
    console.log(`  B URL-валидность (одиночка): ${uv.alive}/${uv.total} живых${uv.total ? ` (${Math.round((uv.alive / uv.total) * 100)}%)` : ''}`)
    console.log(`  C список-vs-проза: ${cWin.toUpperCase()}  (у списка ${units} проверяемых единиц, у прозы ~0)\n`)
    rows.push({ prompt, A: aWin, costMul: mul, B: uv, C: cWin, listUnits: units })
  }

  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
  const alivePct = B.total ? Math.round((B.alive / B.total) * 100) : 0
  console.log('=== ИТОГ ===')
  console.log(`A. МУЛЬТИАГЕНТ: совет лучше в ${A.council}/${PROMPTS.length}, хуже в ${A.single}, ничья ${A.tie}. Цена совета ×${avg(A.costMul).toFixed(1)} к одиночке.`)
  console.log(`   → вывод: ${A.council > A.single + A.tie ? 'совет оправдан' : A.council > A.single ? 'слабый перевес совета — стоит ли ×цена?' : 'совет НЕ бьёт одиночку — реальный риск мнимого улучшения'}`)
  console.log(`B. GROUNDING: у НЕ-grounded генерации живо ${B.alive}/${B.total} URL (${alivePct}%) → ${100 - alivePct}% ссылок выдуманы/мертвы.`)
  console.log(`   → вывод: чем ниже %, тем сильнее объективная нужда в grounding (сверить: тот же тест на выводе продукта с grounding должен дать выше).`)
  console.log(`C. СТРУКТУРА: список лучше для прохождения в ${C.list}/${PROMPTS.length}, проза в ${C.prose}, ничья ${C.tie}. Проверяемых единиц у списка в среднем ${avg(C.listUnits).toFixed(1)}, у прозы ~0.`)
  console.log(`   → вывод: прокси в пользу структуры; РЕАЛЬНАЯ успешность = полевой A/B (completion прогонов) — обязателен для твёрдого вывода.`)
  console.log(`\nПотрачено: ${fmtUsd(spentUsd)}`)

  const out = resolve(process.cwd(), 'scripts', 'ablation-eval-result.json')
  writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), spentUsd, roster: { single: single.id, council: council.map((m) => m.id), aggregator: aggregator.id, judge: judge.id }, summary: { A, B: { ...B, alivePct }, C: { ...C, avgUnits: avg(C.listUnits) } }, rows }, null, 2))
  console.log(`JSON: ${out}`)
}

async function main() {
  if (!API_KEY) {
    console.error('Нет OPENROUTER_API_KEY (.env.local / .env в setfork-frontend). Из РФ openrouter недоступен напрямую — нужен egress/VPN.')
    process.exit(1)
  }
  const mode = process.argv[2] || 'prices'
  if (mode === 'prices') await modePrices()
  else if (mode === 'live') await modeLive()
  else { console.error(`неизвестный режим "${mode}" (prices|live)`); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) })
