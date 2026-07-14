import 'server-only'
import { generateText } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { getAiSettings, getApiKey } from '@/shared/settings/ai'
import { globalBudgetOk } from '@/shared/quota'
import { pickChatModel } from './credits'
import { extractUsage, recordUsage, type AiFeature } from './usage'
import { spotlight, type Spotlight } from './spotlight'
import { parseList, JSON_SHAPE, type GeneratedList, type GenerateOptions } from './generate'
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

// Ростер экспертов-«гномов» (фабрика ролей). persona — внутренняя инструкция; вывод — на языке пользователя.
interface GnomeSpec { id: string; domains: string[]; online?: boolean; persona: string }
const EXPERTS: GnomeSpec[] = [
  { id: 'devops', domains: ['deploy', 'devops', 'ci', 'servers', 'infra', 'docker', 'kubernetes'], persona: 'a pragmatic DevOps gnome: reliability, rollbacks, health-checks, real-world production gotchas' },
  { id: 'coder', domains: ['programming', 'software', 'coding', 'api', 'library', 'framework'], persona: 'a meticulous engineer gnome: correctness, edge-cases, precise runnable steps' },
  { id: 'chef', domains: ['cooking', 'food', 'recipe', 'kitchen', 'baking'], persona: 'a fast practical chef gnome: ingredients, order, timings' },
  { id: 'traveler', domains: ['travel', 'trip', 'city', 'tourism', 'itinerary'], persona: 'a curious traveler gnome: routes, budget, not-to-miss spots' },
  { id: 'coach', domains: ['fitness', 'health', 'workout', 'sport', 'nutrition'], persona: 'a disciplined coach gnome: progression, safety, consistency' },
  { id: 'scholar', domains: ['study', 'learning', 'research', 'course', 'exam'], persona: 'a thoughtful scholar gnome: structure of knowledge, sources, comprehension checks' },
  { id: 'hoarder', domains: ['*'], online: true, persona: 'a resource-investigator gnome: pulls external resources, links and tools' },
  { id: 'generalist', domains: ['*'], persona: 'a well-rounded generalist gnome: a solid list on any topic' },
]
const DEFAULT_COUNCIL_MODELS = ['openai/gpt-4o-mini', 'meta-llama/llama-3.3-70b-instruct', 'mistralai/mistral-nemo']
const INNOVATOR_TEMP = 0.9

function firstJson(t: string): string {
  const s = t.indexOf('{'), e = t.lastIndexOf('}')
  return s >= 0 && e > s ? t.slice(s, e + 1) : t
}
const online = (m: string, web: boolean) => (web && m ? `${m}:online` : m)

/** Мультимодельный «совет гномов». null при ошибке/выкл — caller фолбэкает на generateListDraft. */
export async function generateListCouncil(query: string, lang: Lang, opts: GenerateOptions = {}): Promise<GeneratedList | null> {
  const apiKey = await getApiKey()
  if (!apiKey) return null
  const settings = await getAiSettings()
  if (!settings.enabled) return null
  if (!(await globalBudgetOk())) return null

  const openrouter = createOpenRouter({ apiKey, appName: 'SetFork', appUrl: process.env.APP_URL || 'http://localhost:3000' })
  const langName = langEnName(lang)
  const base = await pickChatModel(settings) // надёжная конфигурируемая модель — мета/критик/синтез
  const pool = settings.councilModels.length ? settings.councilModels : DEFAULT_COUNCIL_MODELS
  const maxGnomes = Math.max(1, Math.min(settings.councilMaxGnomes || 3, EXPERTS.length))
  const web = opts.web ?? true
  const sp: Spotlight = spotlight()
  const topic = sp.wrap('TOPIC', query)
  const feature: AiFeature = opts.feature ?? 'generate'

  // Один под-вызов: генерация + учёт расхода. Ошибка → null (гном «выпал»), совет продолжает.
  async function run(model: string, system: string, prompt: string, maxTokens = settings.maxTokens, temp = settings.temperature): Promise<{ text: string } | null> {
    try {
      const result = await generateText({
        model: openrouter.chat(model, { usage: { include: true } }),
        system,
        prompt,
        temperature: temp,
        maxOutputTokens: maxTokens,
      })
      const u = extractUsage(result)
      await recordUsage({ userId: opts.userId, feature, model, input: u.input, output: u.output, total: u.total, cost: u.cost, refType: opts.refType ?? 'council', refId: opts.refId })
      return { text: result.text }
    } catch (e) {
      console.warn('[council] call failed', e instanceof Error ? e.message : e)
      return null
    }
  }

  // 1) Распорядитель: глубина (single|council) + созыв экспертов по домену (адаптивная глубина = лимит цены).
  const roster = EXPERTS.map((e) => `${e.id}: ${e.persona} [${e.domains.join(',')}]`).join('\n')
  const steward = await run(
    base,
    `You are the steward of a council of expert "gnomes" building a reference checklist. Choose process depth and summon experts.
- depth "single": the topic is simple/everyday (chores, basic personal routines) — no council needed.
- depth "council": summon 1-${maxGnomes} RELEVANT, DIVERSE experts from the roster (for technical/multi-faceted/professional topics).
Return ONLY JSON: {"depth":"single|council","summon":["id",...],"reason":"short"}.
${sp.rule()}
ROSTER:
${roster}`,
    `REQUEST:\n${topic}`,
    200,
  )
  let depth: 'single' | 'council' = 'council'
  let ids: string[] = []
  if (steward) {
    try {
      const p = JSON.parse(firstJson(steward.text)) as { depth?: string; summon?: string[] }
      if (p.depth === 'single') depth = 'single'
      ids = Array.isArray(p.summon) ? p.summon : []
    } catch { /* дефолт council */ }
  }

  const listRules = `You produce a canonical, high-quality reference checklist. All content MUST be in ${langName}.\n${JSON_SHAPE}\n${sp.rule()}`

  // Тривиально → один гном (обычная генерация, но через тот же учёт совета).
  if (depth === 'single') {
    const one = await run(online(base, web), listRules, `Create the reference checklist for the topic below.\n${topic}`)
    return one ? parseList(one.text, query) : null
  }

  // 2) Созыв: эксперты по домену; пол разнообразия — минимум 2 независимых мнения (мудрость толпы).
  const experts = ids.map((id) => EXPERTS.find((e) => e.id === id)).filter((e): e is GnomeSpec => Boolean(e)).slice(0, maxGnomes)
  for (const padId of ['generalist', 'hoarder']) {
    if (experts.length >= 2) break
    const g = EXPERTS.find((e) => e.id === padId)!
    if (!experts.some((e) => e.id === g.id)) experts.push(g)
  }

  // 3) Эксперты набрасывают НЕЗАВИСИМО ∥ + гном-новатор (дивергенция, temp↑).
  const draftJobs = experts.map((e, i) => {
    const model = online(pool[i % pool.length], web && Boolean(e.online))
    const sys = `You are ${e.persona}. Draft a practical checklist for the topic. 6-9 ordered steps: short imperative + one clarifying sentence + a real terminal command only when the step is technical. All content in ${langName}. Return ONLY the draft text.\n${sp.rule()}`
    return run(model, sys, `Draft the checklist.\n${topic}`)
  })
  const innovatorJob = run(
    pool[0],
    `You are an innovator gnome (divergent thinking, Medici-effect cross-domain). Give a FRESH, non-obvious angle on the checklist: what everyone misses, which move from an adjacent field lifts quality. 4-7 bold points. All content in ${langName}. Return ONLY text.\n${sp.rule()}`,
    `Topic:\n${topic}`,
    settings.maxTokens,
    INNOVATOR_TEMP,
  )
  const [drafts, innovation] = await Promise.all([Promise.all(draftJobs), innovatorJob])
  const pooled = [...drafts, innovation].filter((d): d is { text: string } => Boolean(d))
  if (pooled.length === 0) return null // всё упало → пусть caller фолбэкнет
  const anon = pooled.map((d, i) => `--- DRAFT ${String.fromCharCode(65 + i)} ---\n${firstJson(d.text)}`).join('\n\n')

  // 4) Адвокат дьявола (Janis: обязательная оппозиция).
  const critique = await run(
    base,
    `You are a devil's-advocate gnome. Given several anonymous draft checklists (the last is a bold innovation) for one topic, critique them: what's missing, wrong or unsafe, duplicated, whose step is stronger, which bold idea is truly valuable. Be concrete. Write in ${langName}.\n${sp.rule()}`,
    `${topic}\n\nDRAFTS:\n${anon}`,
  )

  // 5) Старейшина-синтез → строгий JSON. Конвергенция, но СОХРАНИ лучшую новизну (не усредняй).
  const elder = await run(
    base,
    `You are the elder synthesizer. Merge the strongest, most accurate and complete steps, honor the critique, drop weak/duplicate ones. IMPORTANT (innovation principle): PRESERVE the 1-2 most valuable non-obvious ideas — do not flatten the list to bland average. All content in ${langName}.\n${listRules}`,
    `${topic}\n\nDRAFTS:\n${anon}\n\nCRITIQUE:\n${critique?.text ?? '(none)'}\n\nReturn the synthesized checklist as strict JSON.`,
  )
  if (elder) return parseList(elder.text, query)
  // Синтез упал — вернём лучший черновик, чтобы список ОБЯЗАТЕЛЬНО получился.
  return drafts.find(Boolean) ? parseList((drafts.find(Boolean) as { text: string }).text, query) : null
}
