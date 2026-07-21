import 'server-only'
import { defaultChatModel, getAiProviderConfig, getOpenRouterApiKey, type AiSettings } from '@/shared/settings/ai'

export interface OpenRouterCredits {
  total: number
  used: number
  remaining: number
  fetchedAt: number
}

let cache: OpenRouterCredits | null = null
const TTL_MS = 60_000

export function clearCreditsCache(): void {
  cache = null
}

export async function getOpenRouterCredits(opts?: { fresh?: boolean }): Promise<OpenRouterCredits | null> {
  const key = await getOpenRouterApiKey() // /credits есть только у OpenRouter
  if (!key) return null
  if (!opts?.fresh && cache && Date.now() - cache.fetchedAt < TTL_MS) return cache
  const url = `${process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1'}/credits`
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' })
    if (!res.ok) {
      console.warn(`[credits] HTTP ${res.status}`)
      return cache
    }
    const json = (await res.json()) as { data?: { total_credits?: number; total_usage?: number } }
    const d = json.data ?? {}
    const total = Number(d.total_credits) || 0
    const used = Number(d.total_usage) || 0
    const value: OpenRouterCredits = { total, used, remaining: Math.max(0, total - used), fetchedAt: Date.now() }
    cache = value
    return value
  } catch (e) {
    console.warn('[credits] fetch error', e instanceof Error ? e.message : e)
    return cache
  }
}

/** Активная модель: если задан порог >0 и баланс ниже — fallback, иначе основная.
 *  Cheap-mode завязан на баланс OpenRouter — на других провайдерах не применяется. */
export async function pickChatModel(settings: AiSettings): Promise<string> {
  const provider = (await getAiProviderConfig())?.provider ?? 'openrouter'
  if (provider === 'openrouter' && settings.cheapModeThreshold > 0 && settings.fallbackModel) {
    const credits = await getOpenRouterCredits()
    if (credits && credits.remaining < settings.cheapModeThreshold) return settings.fallbackModel
  }
  // ai.chat_model в БД мог остаться от другого провайдера (напр. openai/gpt-4o-mini
  // после переключения на yandex): у Яндекса модели строго gpt://… — иначе дефолт
  // провайдера, а не гарантированно битый вызов.
  if (provider === 'yandex' && !settings.chatModel.startsWith('gpt://')) return defaultChatModel()
  return settings.chatModel
}
