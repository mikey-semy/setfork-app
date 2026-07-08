import 'server-only'
import { generateText } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { getAiSettings, getApiKey } from '@/shared/settings/ai'
import { globalBudgetOk } from '@/shared/quota'
import { pickChatModel } from './credits'
import { extractUsage, recordUsage, type AiFeature } from './usage'
import { sanitizeCommand } from './sanitize-command'
import type { Lang } from '@/shared/i18n'

// Потолок размера входного промта (символы). Спасает от раздувания input-токенов
// на огромных списках; middle-out у провайдера — вторая линия обороны.
const MAX_PROMPT_CHARS = 12_000

export { sanitizeCommand }

export interface GeneratedRef {
  label: string
  url: string
}
export interface GeneratedItem {
  title: string
  desc: string
  command: string
  level: 'required' | 'recommended' | 'optional'
  why: string
  subtasks: string[]
  refs: GeneratedRef[]
}
export interface GeneratedList {
  title: string
  desc: string
  tags: string[]
  items: GeneratedItem[]
}

export interface GenerateOptions {
  /** Веб-поиск (OpenRouter `:online`) — список ближе к реальности. */
  web?: boolean
  /** Вариативность: подсказка «сделай ИНАЧЕ» для перегенерации (variant 2, 3…). */
  variant?: number
  /** Для учёта расхода: кто вызвал, какая фича, к чему относится. */
  userId?: string
  feature?: AiFeature
  refType?: string
  refId?: string
}

const JSON_SHAPE = `Return ONLY valid JSON (no markdown fences), exactly this shape:
{"title": string, "desc": string, "tags": string[], "items": [{"title": string, "desc": string, "command": string, "level": "required"|"recommended"|"optional", "why": string, "subtasks": string[], "refs": [{"label": string, "url": string}]}]}
Rules:
- title: concise noun phrase naming the list.
- desc: one sentence describing it.
- tags: 3-6 short lowercase tags, no '#'.
- FIRST decide whether the topic is software/technical (coding, devops, CLI) or NOT (travel, cooking, fitness, planning, study…). This governs the "command" field for every step.
- items: 4-12 ordered steps. title = short imperative. desc = one or two clarifying sentences; you MAY use light markdown (inline code, **bold**, bullet lists).
- command = a real, runnable TERMINAL command ONLY for technical topics where the step is literally typed into a shell (e.g. "npm install", "docker compose up -d"). For NON-technical topics it MUST be "" for every step. NEVER restate the title as a fake command and NEVER wrap a URL in curl/wget just to fill the field (e.g. "curl https://museum.org" is WRONG — put that link in refs, command="").
- refs = 0-3 helpful links for the step (official site, docs, booking/map page). Put ALL URLs here, never in command. Each ref: label = short human name, url = full https URL. Use [] when there is no good link.
- level = how essential the step is. why = one short sentence on WHY this step matters, or "". subtasks = 0-3 short verification checks.`

function parseList(text: string, fallbackTitle: string): GeneratedList | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  let obj: Partial<GeneratedList>
  try {
    obj = JSON.parse(cleaned) as Partial<GeneratedList>
  } catch {
    return null
  }
  const LEVELS = ['required', 'recommended', 'optional']
  const items: GeneratedItem[] = Array.isArray(obj.items)
    ? obj.items
        .slice(0, 20)
        .map((it) => ({
          title: String(it?.title ?? '').trim(),
          desc: String(it?.desc ?? '').trim(),
          command: sanitizeCommand(String(it?.command ?? '')),
          level: (LEVELS.includes(String(it?.level)) ? String(it?.level) : 'required') as GeneratedItem['level'],
          why: String(it?.why ?? '').trim(),
          subtasks: Array.isArray(it?.subtasks) ? it.subtasks.map((s) => String(s).trim()).filter(Boolean).slice(0, 6) : [],
          refs: Array.isArray(it?.refs)
            ? it.refs
                .map((r) => ({ label: String(r?.label ?? '').trim(), url: String(r?.url ?? '').trim() }))
                .filter((r) => r.label && /^https?:\/\//i.test(r.url))
                .slice(0, 3)
            : [],
        }))
        .filter((it) => it.title)
    : []
  if (!items.length) return null
  return {
    title: String(obj.title ?? fallbackTitle).trim().slice(0, 140),
    desc: String(obj.desc ?? '').trim(),
    tags: Array.isArray(obj.tags) ? obj.tags.map((t) => String(t)) : [],
    items,
  }
}

/** Общий прогон модели: генерация текста + учёт расхода + парс JSON-списка. */
async function runListModel(
  system: string,
  prompt: string,
  fallbackTitle: string,
  feature: AiFeature,
  opts: GenerateOptions,
): Promise<GeneratedList | null> {
  const apiKey = await getApiKey()
  if (!apiKey) return null
  const settings = await getAiSettings()
  if (!settings.enabled) return null
  if (!(await globalBudgetOk())) return null // глобальный дневной кап расхода исчерпан

  const web = opts.web ?? false
  const openrouter = createOpenRouter({
    apiKey,
    appName: 'SetFork',
    appUrl: process.env.APP_URL || 'http://localhost:3000',
  })
  const base = await pickChatModel(settings)
  const online = (m: string) => (web && m ? `${m}:online` : m)
  const models = [base, settings.fallbackModel].filter((v, i, a) => v && a.indexOf(v) === i).map(online)

  try {
    const result = await generateText({
      model: openrouter.chat(online(base), { usage: { include: true }, extraBody: { models, transforms: ['middle-out'] } }),
      system,
      prompt,
      temperature: settings.temperature,
      maxOutputTokens: settings.maxTokens,
    })
    // Учёт расхода — до парсинга (токены потрачены в любом случае).
    const u = extractUsage(result)
    await recordUsage({
      userId: opts.userId,
      feature,
      model: base,
      input: u.input,
      output: u.output,
      total: u.total,
      cost: u.cost,
      refType: opts.refType,
      refId: opts.refId,
    })
    return parseList(result.text, fallbackTitle)
  } catch (e) {
    console.warn('[generate] failed', e instanceof Error ? e.message : e)
    return null
  }
}

/** Черновик эталонного списка по запросу. null при ошибке/выкл. */
export async function generateListDraft(query: string, lang: Lang, opts: GenerateOptions = {}): Promise<GeneratedList | null> {
  const langName = lang === 'ru' ? 'Russian' : 'English'
  const web = opts.web ?? true
  const variantHint =
    opts.variant && opts.variant > 1
      ? `\nThis is regeneration attempt #${opts.variant}: produce a MEANINGFULLY DIFFERENT take (different angle, ordering or scope) from a typical answer.`
      : ''
  const system = `You generate a canonical, high-quality, community-grade reference checklist as STRICT JSON.
All content MUST be in ${langName}.
${web ? 'Use up-to-date web search results to make the checklist accurate and current.\n' : ''}${JSON_SHAPE}
- Be accurate and practical. Everything in ${langName}.${variantHint}`
  const feature: AiFeature = opts.feature ?? (opts.variant && opts.variant > 1 ? 'regenerate' : 'generate')
  return runListModel(system, `Create the reference list for: ${query}`, query, feature, { ...opts, web })
}

type NoteItem = { title: string; desc: string; command: string; subtasks: string[] }

/** Примечание к версии из диффа (как git-commit message). Возвращает одну строку или null. */
export async function generateChangeNote(
  base: NoteItem[],
  next: NoteItem[],
  lang: Lang,
  opts: GenerateOptions = {},
): Promise<string | null> {
  const apiKey = await getApiKey()
  if (!apiKey) return null
  const settings = await getAiSettings()
  if (!settings.enabled) return null
  if (!(await globalBudgetOk())) return null // глобальный дневной кап расхода исчерпан

  const openrouter = createOpenRouter({
    apiKey,
    appName: 'SetFork',
    appUrl: process.env.APP_URL || 'http://localhost:3000',
  })
  const model = await pickChatModel(settings)
  const langName = lang === 'ru' ? 'Russian' : 'English'
  const compact = (xs: NoteItem[]) =>
    xs.map((x, i) => `${i + 1}. ${x.title}${x.command ? ` [${x.command}]` : ''}`).join('\n').slice(0, MAX_PROMPT_CHARS)

  try {
    const result = await generateText({
      model: openrouter.chat(model, { usage: { include: true } }),
      system: `You write a SHORT changelog note (like a git commit message) describing what changed between two versions of a checklist, and why it matters. One concise line, imperative mood, in ${langName}. No quotes, no markdown, max ~90 characters.`,
      prompt: `BEFORE:\n${compact(base) || '(empty)'}\n\nAFTER:\n${compact(next) || '(empty)'}\n\nWrite the change note.`,
      temperature: 0.3,
      maxOutputTokens: 60,
    })
    const u = extractUsage(result)
    await recordUsage({ userId: opts.userId, feature: 'note', model, input: u.input, output: u.output, total: u.total, cost: u.cost, refType: opts.refType, refId: opts.refId })
    const note = result.text.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').slice(0, 140)
    return note || null
  } catch (e) {
    console.warn('[change-note] failed', e instanceof Error ? e.message : e)
    return null
  }
}

/** Правка существующего списка по инструкции пользователя (AI-refine). */
export async function generateListRefine(
  current: { title: string; desc: string; tags: string[]; items: GeneratedItem[] },
  instruction: string,
  lang: Lang,
  opts: GenerateOptions = {},
): Promise<GeneratedList | null> {
  const langName = lang === 'ru' ? 'Russian' : 'English'
  const web = opts.web ?? false
  const system = `You REFINE an existing checklist per the user's instruction, returning the FULL updated list as STRICT JSON.
All content MUST be in ${langName}.
Preserve good existing content and ordering; change only what the instruction requires. Do not drop unrelated steps.
${web ? 'You may use web search to ground new content.\n' : ''}${JSON_SHAPE}
- Everything in ${langName}.`
  const prompt = `Current list (JSON):
${JSON.stringify(current).slice(0, MAX_PROMPT_CHARS)}

Instruction: ${instruction.slice(0, 2_000)}`
  return runListModel(system, prompt, current.title, 'refine', { ...opts, web })
}
