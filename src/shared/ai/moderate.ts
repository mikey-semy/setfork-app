import 'server-only'
import { generateText } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { getAiSettings, getApiKey } from '@/shared/settings/ai'
import { pickChatModel } from './credits'

/** ИИ-классификатор безопасности контента. null — если ИИ недоступен/ошибка. */
export async function moderateContent(text: string): Promise<{ flagged: boolean; reason: string } | null> {
  const apiKey = await getApiKey()
  if (!apiKey || !text.trim()) return null
  const settings = await getAiSettings()
  const openrouter = createOpenRouter({
    apiKey,
    appName: 'SetHub',
    appUrl: process.env.APP_URL || 'http://localhost:3000',
  })
  const model = await pickChatModel(settings)
  try {
    const { text: out } = await generateText({
      model: openrouter.chat(model),
      system: `You are a content-safety classifier for a public checklist site.
Flag a list ONLY if it gives actionable instructions for clearly harmful/illegal activity:
weapons or explosives manufacturing, creating dangerous substances/poisons, malware or hacking meant to cause harm,
violence, self-harm, or sexual content involving minors.
Educational, defensive-security, legal and everyday technical content is SAFE.
Return ONLY strict JSON, no markdown: {"flagged": boolean, "reason": string}. Keep reason short.`,
      prompt: `Classify this list:\n${text.slice(0, 4000)}`,
      temperature: 0,
      maxOutputTokens: 200,
    })
    const cleaned = out.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    const obj = JSON.parse(cleaned) as { flagged?: unknown; reason?: unknown }
    return { flagged: !!obj.flagged, reason: String(obj.reason ?? '').slice(0, 300) }
  } catch {
    return null
  }
}
