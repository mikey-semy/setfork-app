import 'server-only'
import { generateText } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { getAiSettings, getApiKey } from '@/shared/settings/ai'
import { globalBudgetOk } from '@/shared/quota'
import { pickChatModel } from './credits'
import { extractUsage, recordUsage, type AiFeature } from './usage'
import { spotlight, type Spotlight } from './spotlight'
import { parseList, JSON_SHAPE, type GeneratedList, type GenerateOptions } from './generate'
import { findPrecedents } from './retrieval'
import { pushCouncilEvent, type CouncilEvent } from './council-progress'
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
// name/ru — подпись в беседе (ru — на русском). id — ещё и имя аватарки: `public/gnomes/<id>.webp`,
// поэтому новому эксперту нужна картинка с тем же id (иначе UI молча возьмёт дефолтную).
interface GnomeSpec { id: string; domains: string[]; online?: boolean; persona: string; name: string; ru: string }
const EXPERTS: GnomeSpec[] = [
  { id: 'devops', name: 'Devops', ru: 'Девопсер', domains: ['deploy', 'devops', 'ci', 'servers', 'infra', 'docker', 'kubernetes'], persona: 'a pragmatic DevOps expert: reliability, rollbacks, health-checks, real-world production gotchas' },
  { id: 'coder', name: 'Coder', ru: 'Кодер', domains: ['programming', 'software', 'coding', 'api', 'library', 'framework'], persona: 'a meticulous software engineer: correctness, edge-cases, precise runnable steps' },
  { id: 'chef', name: 'Chef', ru: 'Повар', domains: ['cooking', 'food', 'recipe', 'kitchen', 'baking'], persona: 'a fast, practical chef: ingredients, order, timings' },
  { id: 'traveler', name: 'Wanderer', ru: 'Странник', domains: ['travel', 'trip', 'city', 'tourism', 'itinerary'], persona: 'a curious traveler: routes, budget, not-to-miss spots' },
  { id: 'coach', name: 'Coach', ru: 'Тренер', domains: ['fitness', 'health', 'workout', 'sport', 'nutrition'], persona: 'a disciplined coach: progression, safety, consistency' },
  { id: 'scholar', name: 'Scholar', ru: 'Книжник', domains: ['study', 'learning', 'research', 'course', 'exam'], persona: 'a thoughtful scholar: structure of knowledge, sources, comprehension checks' },
  { id: 'hoarder', name: 'Hoarder', ru: 'Барахольщик', domains: ['*'], online: true, persona: 'a resource investigator: pulls external resources, links and tools' },
  { id: 'generalist', name: 'Generalist', ru: 'Универсал', domains: ['*'], persona: 'a well-rounded generalist: a solid list on any topic' },
]
const DEFAULT_COUNCIL_MODELS = ['openai/gpt-4o-mini', 'meta-llama/llama-3.3-70b-instruct', 'mistralai/mistral-nemo']
const INNOVATOR_TEMP = 0.9
// Потолок на ОДИН вызов: зависшая/медленная модель не должна вешать весь совет (6-7 вызовов).
// Превышение → вызов падает → гном «выпадает», совет продолжает без него.
const CALL_TIMEOUT_MS = 60_000

function firstJson(t: string): string {
  const s = t.indexOf('{'), e = t.lastIndexOf('}')
  return s >= 0 && e > s ? t.slice(s, e + 1) : t
}
const online = (m: string, web: boolean) => (web && m ? `${m}:online` : m)

/** Результат совета: готовый список, ИЛИ уточняющие вопросы (диалог), ИЛИ null (ошибка/выкл → фолбэк). */
export type CouncilResult = GeneratedList | { clarify: string[] } | null

/** Мультимодельный «совет гномов». null при ошибке/выкл — caller фолбэкает на generateListDraft. */
export async function generateListCouncil(query: string, lang: Lang, opts: GenerateOptions = {}): Promise<CouncilResult> {
  const apiKey = await getApiKey()
  if (!apiKey) return null
  const settings = await getAiSettings()
  if (!settings.enabled) return null
  if (!(await globalBudgetOk())) return null

  const openrouter = createOpenRouter({ apiKey, appName: 'SetFork', appUrl: process.env.APP_URL || 'http://localhost:3000' })
  const langName = langEnName(lang)
  const base = await pickChatModel(settings) // конфигурируемая модель — для ФИНАЛЬНОГО списка (качество)
  const pool = settings.councilModels.length ? settings.councilModels : DEFAULT_COUNCIL_MODELS
  // Быстрая модель для ПРОМЕЖУТОЧНЫХ шагов (распорядитель-классификатор, критик, веб-поиск):
  // reasoning-модель там не нужна, а совет из 6-7 вызовов на ней тормозит минутами. Финал — на base.
  const fast = pool[0] || base
  const maxGnomes = Math.max(1, Math.min(settings.councilMaxGnomes || 3, EXPERTS.length))
  const web = opts.web ?? true
  const sp: Spotlight = spotlight()
  const topic = sp.wrap('TOPIC', query)
  const feature: AiFeature = opts.feature ?? 'generate'
  const ru = lang === 'ru'
  const say = (en: string, rus: string) => (ru ? rus : en) // строки-аргументы, не тернар-с-литералами (i18n-lint)
  // Подпись говорящего в беседе (идентичность роли несёт аватарка, поэтому эмодзи в ростере больше нет).
  const gtitle = (e: GnomeSpec) => (ru ? e.ru : e.name)
  // «Театр беседы»: публикуем ход совета для страницы генерации (по refId=generationId).
  // fire-and-forget: публикация в стор (Redis/память) не должна блокировать/ронять генерацию.
  const emit = (kind: CouncilEvent['kind'], text: string, who?: string, name?: string) => {
    if (opts.refId) void pushCouncilEvent(opts.refId, { kind, text, who, name }).catch(() => {})
  }

  // Один под-вызов: генерация + учёт расхода. Ошибка → null (гном «выпал»), совет продолжает.
  async function run(model: string, system: string, prompt: string, maxTokens = settings.maxTokens, temp = settings.temperature): Promise<{ text: string } | null> {
    try {
      const result = await generateText({
        model: openrouter.chat(model, { usage: { include: true } }),
        system,
        prompt,
        temperature: temp,
        maxOutputTokens: maxTokens,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      })
      const u = extractUsage(result)
      await recordUsage({ userId: opts.userId, feature, model, input: u.input, output: u.output, total: u.total, cost: u.cost, refType: opts.refType ?? 'council', refId: opts.refId })
      return { text: result.text }
    } catch (e) {
      console.warn('[council] call failed', e instanceof Error ? e.message : e)
      return null
    }
  }

  // 1) Распорядитель: глубина (single|council|clarify) + созыв экспертов по домену (адаптивная глубина = лимит цены).
  const roster = EXPERTS.map((e) => `${e.id}: ${e.persona} [${e.domains.join(',')}]`).join('\n')
  const clarifyLine = settings.councilClarify
    ? '- depth "clarify": the request is too vague for a useful list — a bare fragment or pronoun ("organize it", "plan the thing", "help me"), OR the good answer hinges on unstated parameters (budget / skill level / goal / constraints). Return 2-3 short clarifying questions in "questions". PREFER clarify over single/council whenever the request is underspecified this way.\n'
    : ''
  const jsonShape = settings.councilClarify
    ? '{"depth":"single|council|clarify","summon":["id",...],"questions":["...only if clarify"],"reason":"short"}'
    : '{"depth":"single|council","summon":["id",...],"reason":"short"}'
  const steward = await run(
    fast,
    `You are the steward of a panel of domain experts building a reference checklist. Choose process depth and summon experts.
${clarifyLine}- depth "single": the topic is clear AND simple/everyday (chores, basic personal routines) — no council needed.
- depth "council": the topic is clear but technical/multi-faceted/professional — summon 1-${maxGnomes} RELEVANT, DIVERSE experts from the roster.
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
  if (steward) {
    try {
      const p = JSON.parse(firstJson(steward.text)) as { depth?: string; summon?: string[]; questions?: string[] }
      if (p.depth === 'single') depth = 'single'
      else if (p.depth === 'clarify' && settings.councilClarify) depth = 'clarify'
      ids = Array.isArray(p.summon) ? p.summon : []
      questions = Array.isArray(p.questions) ? p.questions.filter((q) => typeof q === 'string' && q.trim()).map((q) => q.trim()).slice(0, 3) : []
    } catch { /* дефолт council */ }
  }

  // Диалог: не хватает ключевого → возвращаем уточняющие вопросы (совет не гоним, ждём ответов пользователя).
  if (depth === 'clarify' && questions.length) {
    emit('plan', say('The request is vague — I need a couple of details', 'Запрос размытый — нужна пара деталей'), 'reporter', say('Reporter', 'Репортёр'))
    return { clarify: questions }
  }

  const listRules = `You produce a canonical, high-quality reference checklist. All content MUST be in ${langName}.\n${JSON_SHAPE}\n${sp.rule()}`

  // Тривиально → один гном (обычная генерация, но через тот же учёт совета).
  if (depth === 'single') {
    emit('plan', say('Simple topic — writing it up right away', 'Тема простая — пишу сразу'), 'planner', say('Planner', 'Планировщик'))
    const one = await run(online(base, web), listRules, `Create the reference checklist for the topic below.\n${topic}`)
    return one ? parseList(one.text, query) : null
  }
  emit('plan', say('The topic is many-sided — convening the council', 'Тема многогранная — собираем совет'), 'planner', say('Planner', 'Планировщик'))

  // 2) Созыв: эксперты по домену; пол разнообразия — минимум 2 независимых мнения (мудрость толпы).
  const experts = ids.map((id) => EXPERTS.find((e) => e.id === id)).filter((e): e is GnomeSpec => Boolean(e)).slice(0, maxGnomes)
  for (const padId of ['generalist', 'hoarder']) {
    if (experts.length >= 2) break
    const g = EXPERTS.find((e) => e.id === padId)!
    if (!experts.some((e) => e.id === g.id)) experts.push(g)
  }
  emit('summon', say(`Consulting: ${experts.map(gtitle).join(', ')}`, `Созываю: ${experts.map(gtitle).join(', ')}`), 'crier', say('Coordinator', 'Координатор'))

  // 2.5) Старейшина-искатель: прецеденты из НАШИХ списков (pgvector). Пусто на пустом корпусе — ок.
  const precedents = await findPrecedents(query, lang, { userId: opts.userId })
  // Форма «X: N» — чтобы не склонять числительное (было «3 похожих списков») и не тащить плюрализацию в ленту.
  if (precedents.length) emit('seek', say(`Similar lists in our library: ${precedents.length}`, `Похожих списков в библиотеке: ${precedents.length}`), 'seek-lists', say('Librarian', 'Библиотекарь'))
  let lore = precedents.length
    ? `\n\nPRECEDENTS from our library (similar existing lists — reuse good structure, avoid duplicating, improve on them):\n${precedents.map((p, i) => `${i + 1}. ${p.title}${p.desc ? ' — ' + p.desc : ''}${p.tags.length ? ' [' + p.tags.join(', ') + ']' : ''}`).join('\n')}`
    : ''

  // Веб-искатель (старейшина advanced-тира): интернет-прецеденты сверх наших списков (за флагом council_web_seek).
  if (settings.councilWebSeek) {
    emit('seek', say('Searching the web for precedents…', 'Ищу прецеденты в интернете…'), 'seek-web', say('Web scout', 'Веб-разведчик'))
    const webSys = `You are a knowledgeable researcher with web access. Find 3-5 concise, REAL precedents/analogies for building a checklist on this topic: how it is typically done, common pitfalls, authoritative approaches. Short bullet list in ${langName}. Return ONLY the bullets.\n${sp.rule()}`
    const webRes = await run(online(fast, true), webSys, `Topic:\n${topic}`, 500)
    if (webRes && webRes.text.trim()) lore += `\n\nWEB PRECEDENTS (from the elder's web search — verify, don't copy blindly):\n${webRes.text.trim()}`
  }

  // 3) Эксперты набрасывают НЕЗАВИСИМО ∥ (получая прецеденты) + гном-новатор (дивергенция, temp↑, БЕЗ прецедентов — чтобы расходился).
  const draftJobs = experts.map((e, i) => {
    const model = online(pool[i % pool.length], web && Boolean(e.online))
    const sys = `You are ${e.persona}. Draft a practical checklist for the topic. 6-9 ordered steps: short imperative + one clarifying sentence + a real terminal command only when the step is technical. All content in ${langName}. Return ONLY the draft text.\n${sp.rule()}`
    emit('draft', say('drafting the checklist…', 'набрасывает список…'), e.id, gtitle(e))
    return run(model, sys, `Draft the checklist.\n${topic}${lore}`)
  })
  emit('innovate', say('Exploring a bold, non-obvious angle…', 'Ищу смелый неочевидный ход…'), 'innovator', say('Innovator', 'Новатор'))
  const innovatorJob = run(
    pool[0],
    `You are an innovator (divergent thinking, Medici-effect cross-domain). Give a FRESH, non-obvious angle on the checklist: what everyone misses, which move from an adjacent field lifts quality. 4-7 bold points. All content in ${langName}. Return ONLY text.\n${sp.rule()}`,
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
  emit('critique', say('Reviewing the drafts critically…', 'Критически разбираю черновики…'), 'critic', say('Critic', 'Критик'))
  const critique = await run(
    fast,
    `You are a devil's advocate reviewer. Given several anonymous draft checklists (the last is a bold innovation) for one topic, critique them: what's missing, wrong or unsafe, duplicated, whose step is stronger, which bold idea is truly valuable. Be concrete. Write in ${langName}.\n${sp.rule()}`,
    `${topic}\n\nDRAFTS:\n${anon}`,
  )

  // 5) Старейшина-синтез → строгий JSON. Конвергенция, но СОХРАНИ лучшую новизну (не усредняй).
  emit('synth', say('Synthesizing the final list…', 'Свожу финальный список…'), 'elder', say('Elder', 'Старейшина'))
  const elder = await run(
    base,
    `You are the lead synthesizer. Merge the strongest, most accurate and complete steps, honor the critique, drop weak/duplicate ones. IMPORTANT (innovation principle): PRESERVE the 1-2 most valuable non-obvious ideas — do not flatten the list to bland average. All content in ${langName}.\n${listRules}`,
    `${topic}${lore}\n\nDRAFTS:\n${anon}\n\nCRITIQUE:\n${critique?.text ?? '(none)'}\n\nReturn the synthesized checklist as strict JSON.`,
  )
  if (elder) return parseList(elder.text, query)
  // Синтез упал — вернём лучший черновик, чтобы список ОБЯЗАТЕЛЬНО получился.
  return drafts.find(Boolean) ? parseList((drafts.find(Boolean) as { text: string }).text, query) : null
}
