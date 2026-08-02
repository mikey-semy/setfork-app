import 'server-only'
import { getModelSettings, getOpenRouterApiKey, type AiSettings } from '@/shared/settings/ai'
import { generationProviderConfig } from './provider-failover'
import { fetchModelsFor } from './models'
import { liveModel, workhorses } from './model-picker'
import { baseModelId, quarantinedModels } from './health'

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
    import('./pricing'),
  ])
  const [r] = await db
    .select({ usd: sql<number>`coalesce(sum(${aiUsage.costUsd}),0)::float8` })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, sql`date_trunc('day', now())`))
  const rub = (r?.usd ?? 0) * (await rubPerUsd())
  daySpendCache = { rub, at: Date.now() }
  return rub
}

/**
 * Активная модель: задан порог >0 и он превышен — fallback, иначе основная.
 * OpenRouter: порог = минимальный остаток баланса ($). Яндекс: баланса в API нет —
 * порог трактуется как ДНЕВНОЙ расход в ₽ (по нашему журналу с прайс-таблицей).
 *
 * Последним шагом выбранная модель СВЕРЯЕТСЯ С КАТАЛОГОМ: провайдеры снимают модели с
 * обслуживания, и назначенный id однажды начинает отвечать 404 при исправном ключе — именно
 * так генерация молча возвращала пустоту (аудит 2026-08-01). Каталога нет (нет ключа, сеть,
 * гео-блок) — выбор владельца остаётся как есть: отсутствие сведений не повод его подменять.
 */
export async function pickChatModel(settings: AiSettings): Promise<string> {
  return (await pickChatModels(settings)).base
}

/**
 * Основная и запасная модель ОДНОГО провайдера — того, на котором пойдёт генерация.
 *
 * Возвращаем пару, а не одну модель, потому что запасная нужна вызывающему для списка
 * кандидатов, и брать её из `settings` нельзя: настройки собраны для НАСТРОЕННОГО провайдера,
 * а генерация могла уйти на запасного. Тогда `settings.fallbackModel` — чужой id, и «запасная
 * модель» гарантированно отвечает отказом (находка авто-ревью, P2).
 */
export async function pickChatModels(settings: AiSettings): Promise<{ provider: string; base: string; fallback: string }> {
  const cfg = await generationProviderConfig()
  const provider = cfg?.provider ?? 'openrouter'
  // Настройки моделей лежат в неймспейсе ПРОВАЙДЕРА. При уходе на запасного взять модель из
  // неймспейса основного значило бы позвать чужой id — молча и с гарантированным отказом.
  const effective = provider === settings.provider ? settings : { ...settings, ...(await getModelSettings(provider)) }
  // Три обращения независимы (настройка модели, каталог, здоровье) — идут разом: последовательно
  // они складывались бы в задержку перед КАЖДОЙ генерацией.
  const [wanted, { chat }, bad] = await Promise.all([
    pickConfiguredModel(effective, provider, cfg?.headers?.['x-folder-id'] ?? ''),
    fetchModelsFor(provider),
    quarantinedModels(),
  ])
  const live = liveModel(chat, wanted)
  if (live !== wanted) {
    console.warn(`[ai] модель ${wanted} отсутствует в каталоге ${provider} — беру живую ${live}`)
  }
  // Запасная тоже сверяется с каталогом: мёртвый id в роли «запасной» — это не запас.
  const fallback = effective.fallbackModel && chat.some((m) => m.id === effective.fallbackModel) ? effective.fallbackModel : ''
  return { provider, base: healthy(live, fallback, chat, bad), fallback }
}

/**
 * КАРАНТИН — и для одиночной генерации тоже. Механизм существовал только для пула совета:
 * модель с проседающим успехом оставалась основной моделью обычной генерации, пока владелец
 * не заметит и не сменит руками. Порядок замены: сперва назначенная запасная, потом самая
 * дешёвая здоровая из каталога. Всё в карантине — работаем на исходной: медленная генерация
 * лучше отсутствующей (то же правило, что у filterByQuarantine в совете).
 */
export function healthy(model: string, fallback: string, chat: Parameters<typeof workhorses>[0], bad: ReadonlySet<string>): string {
  if (!model || !bad.has(baseModelId(model))) return model
  if (fallback && !bad.has(baseModelId(fallback)) && chat.some((m) => m.id === fallback)) {
    console.warn(`[ai] модель ${model} в карантине — беру запасную ${fallback}`)
    return fallback
  }
  const spare = workhorses(chat).find((m) => !bad.has(baseModelId(m.id)) && m.id !== model)
  if (spare) {
    console.warn(`[ai] модель ${model} в карантине — беру здоровую ${spare.id} из каталога`)
    return spare.id
  }
  return model
}

/** Что назначено настройками (без сверки с каталогом) — отдельно, чтобы правило чтения
 *  настроек можно было читать глазами и проверять тестом. */
async function pickConfiguredModel(settings: AiSettings, provider: string, folder: string): Promise<string> {
  if (provider === 'openrouter' && settings.cheapModeThreshold > 0 && settings.fallbackModel) {
    const credits = await getOpenRouterCredits()
    if (credits && credits.remaining < settings.cheapModeThreshold) return settings.fallbackModel
  }
  if (provider === 'yandex' && settings.cheapModeThreshold > 0 && settings.fallbackModel.startsWith('gpt://')) {
    if ((await dailySpendRub(settings.cheapModeThreshold)) > settings.cheapModeThreshold) return settings.fallbackModel
  }
  // Чужой id в неймспейсе провайдера (вписали руками) больше не лечится подстановкой
  // конкретной модели из кода: такой id просто не найдётся в каталоге, и замену выберет
  // сам каталог. Раньше здесь стояли 'gpt://…/yandexgpt-5.1/latest' и 'GigaChat-2' —
  // те же мины замедленного действия, что и снятая модель в env.
  void folder
  return settings.chatModel
}
