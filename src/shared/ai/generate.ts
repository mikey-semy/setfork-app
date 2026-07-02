import 'server-only'
import { generateText } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { getAiSettings, getApiKey } from '@/shared/settings/ai'
import { pickChatModel } from './credits'
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

/** Черновик эталонного списка по запросу (LLM через OpenRouter). null при ошибке/выкл. */
export async function generateListDraft(query: string, lang: Lang): Promise<GeneratedList | null> {
  const apiKey = await getApiKey()
  if (!apiKey) return null
  const settings = await getAiSettings()
  if (!settings.enabled) return null

  const openrouter = createOpenRouter({
    apiKey,
    appName: 'SetHub',
    appUrl: process.env.APP_URL || 'http://localhost:3000',
  })
  const model = await pickChatModel(settings)
  const models = [model, settings.fallbackModel].filter((v, i, a) => v && a.indexOf(v) === i)
  const langName = lang === 'ru' ? 'Russian' : 'English'

  try {
    const { text } = await generateText({
      model: openrouter.chat(model, { extraBody: { models, transforms: ['middle-out'] } }),
      system: `You generate a canonical, high-quality, community-grade reference checklist as STRICT JSON.
All content MUST be in ${langName}.
Return ONLY valid JSON (no markdown fences), exactly this shape:
{"title": string, "desc": string, "tags": string[], "items": [{"title": string, "desc": string, "command": string, "subtasks": string[]}]}
Rules:
- title: concise noun phrase naming the list.
- desc: one sentence describing it.
- tags: 3-6 short lowercase tags, no '#'.
- items: 4-10 ordered steps. title = short imperative. desc = one clarifying sentence. command = a shell command when applicable, else "". subtasks = 0-3 short verification checks.
- Be accurate and practical. Everything in ${langName}.`,
      prompt: `Create the reference list for: ${query}`,
      temperature: settings.temperature,
      maxOutputTokens: settings.maxTokens,
    })

    const cleaned = text
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim()
    const obj = JSON.parse(cleaned) as Partial<GeneratedList>

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
      title: String(obj.title ?? query).trim().slice(0, 140),
      desc: String(obj.desc ?? '').trim(),
      tags: Array.isArray(obj.tags) ? obj.tags.map((t) => String(t)) : [],
      items,
    }
  } catch (e) {
    console.warn('[generate] failed', e instanceof Error ? e.message : e)
    return null
  }
}
