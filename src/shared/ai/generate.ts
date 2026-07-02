import 'server-only'
import { generateText } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { getAiSettings, getApiKey } from '@/shared/settings/ai'
import { pickChatModel } from './credits'
import { extractUsage, recordUsage, type AiFeature } from './usage'
import type { Lang } from '@/shared/i18n'

export interface GeneratedItem {
  title: string
  desc: string
  command: string
  subtasks: string[]
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
{"title": string, "desc": string, "tags": string[], "items": [{"title": string, "desc": string, "command": string, "subtasks": string[]}]}
Rules:
- title: concise noun phrase naming the list.
- desc: one sentence describing it.
- tags: 3-6 short lowercase tags, no '#'.
- items: 4-12 ordered steps. title = short imperative. desc = one clarifying sentence. command = a shell command when applicable, else "". subtasks = 0-3 short verification checks.`

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
  const items: GeneratedItem[] = Array.isArray(obj.items)
    ? obj.items
        .slice(0, 20)
        .map((it) => ({
          title: String(it?.title ?? '').trim(),
          desc: String(it?.desc ?? '').trim(),
          command: String(it?.command ?? '').trim(),
          subtasks: Array.isArray(it?.subtasks) ? it.subtasks.map((s) => String(s).trim()).filter(Boolean).slice(0, 6) : [],
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

  const web = opts.web ?? false
  const openrouter = createOpenRouter({
    apiKey,
    appName: 'SetHub',
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
${JSON.stringify(current)}

Instruction: ${instruction}`
  return runListModel(system, prompt, current.title, 'refine', { ...opts, web })
}
