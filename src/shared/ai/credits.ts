import 'server-only'
import { getAiProviderConfig, getOpenRouterApiKey, type AiSettings } from '@/shared/settings/ai'

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

// Дневной ₽-расход для яндекс-cheap-mode кэшируем на 60с (дёргается на каждом вызове).
// У ПОРОГА кэш выключаем: иначе после превышения работа ещё до минуты идёт по дорогой
// модели — тот же приём, из-за которого дневной кап пропускал вызовы окном (линза 03,
// №2 и №9). Порог передаёт вызывающий: он им и меряет.
let daySpendCache: { rub: number; at: number } | null = null

async function dailySpendRub(threshold: number): Promise<number> {
  const nearThreshold = !!daySpendCache && daySpendCache.rub >= threshold * 0.8
  if (daySpendCache && !nearThreshold && Date.now() - daySpendCache.at < 60_000) return daySpendCache.rub
  const [{ db, aiUsage }, { sql, gte }, { rubPerUsd }] = await Promise.all([
    import('@/shared/db'),
    import('drizzle-orm'),
    import('./yandex-pricing'),
  ])
  const [r] = await db
    .select({ usd: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float8` })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, sql`date_trunc('day', now())`))
  const rub = (r?.usd ?? 0) * rubPerUsd()
  daySpendCache = { rub, at: Date.now() }
  return rub
}

/** Активная модель: задан порог >0 и он превышен — fallback, иначе основная.
 *  OpenRouter: порог = минимальный остаток баланса ($). Яндекс: баланса в API нет —
 *  порог трактуется как ДНЕВНОЙ расход в ₽ (по нашему журналу с хардкод-прайсом). */
export async function pickChatModel(settings: AiSettings): Promise<string> {
  const cfg = await getAiProviderConfig()
  const provider = cfg?.provider ?? 'openrouter'
  if (provider === 'openrouter' && settings.cheapModeThreshold > 0 && settings.fallbackModel) {
    const credits = await getOpenRouterCredits()
    if (credits && credits.remaining < settings.cheapModeThreshold) return settings.fallbackModel
  }
  if (provider === 'yandex' && settings.cheapModeThreshold > 0 && settings.fallbackModel.startsWith('gpt://')) {
    if ((await dailySpendRub(settings.cheapModeThreshold)) > settings.cheapModeThreshold) return settings.fallbackModel
  }
  // Неймспейсы дают провайдер-корректную модель уже на чтении; этот гвард —
  // последний рубеж (руками вписали чужой id в яндекс-неймспейс).
  if (provider === 'yandex' && !settings.chatModel.startsWith('gpt://')) {
    const folder = cfg?.headers?.['x-folder-id'] ?? ''
    return `gpt://${folder}/yandexgpt-5.1/latest`
  }
  if (provider === 'gigachat' && settings.chatModel.includes('/')) return 'GigaChat-2'
  return settings.chatModel
}
