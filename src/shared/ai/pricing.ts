import 'server-only'
import type { AiProviderId } from '@/shared/settings/ai'
import { estimateRubModelCostUsd, getPriceBook, rubPerUsdOf } from './price-book'

// Единая оценка стоимости вызова по ЛЮБОМУ провайдеру (для колонки cost_usd —
// на ней держатся денежные квоты и дашборд расхода):
// - openrouter: cost приходит в ответе API (extractUsage) — оценка не нужна;
// - yandex и gigachat: API цен нет, берём прайс-книгу стенда (price-book) — ДАННЫЕ,
//   а не таблица в этом файле: цены меняются чаще, чем выходит деплой;
// - selectel: цены ЕСТЬ в их /models (₽/токен) — кешируем каталог и считаем.
// Нет цены → null (честный 0 у вызывающего, не выдуманная цифра).

// Selectel: каталог с ценами (₽/токен) кешируем на час. Строится только когда
// selectel — активный провайдер (иначе нет конфига/ключа) — этого достаточно:
// расход по нему и возникает только в это время.
let selectelCache: { at: number; prices: Map<string, [number, number]> } | null = null
const SELECTEL_CACHE_TTL_MS = 3_600_000

async function selectelPriceRub(modelId: string): Promise<[number, number] | null> {
  if (!selectelCache || Date.now() - selectelCache.at > SELECTEL_CACHE_TTL_MS) {
    const { getAiProviderConfig } = await import('@/shared/settings/ai')
    const cfg = await getAiProviderConfig()
    if (cfg?.provider !== 'selectel') return selectelCache?.prices.get(modelId) ?? null
    try {
      const res = await fetch(`${cfg.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return selectelCache?.prices.get(modelId) ?? null
      const data = (await res.json()) as { data?: { id: string; pricing?: { prompt?: string; completion?: string } }[] }
      const prices = new Map<string, [number, number]>()
      for (const mdl of data.data ?? []) {
        if (mdl.pricing) prices.set(mdl.id, [Number(mdl.pricing.prompt) || 0, Number(mdl.pricing.completion) || 0])
      }
      selectelCache = { at: Date.now(), prices }
    } catch {
      return selectelCache?.prices.get(modelId) ?? null
    }
  }
  return selectelCache.prices.get(modelId) ?? null
}

/** Оценка стоимости вызова в USD; null = цена неизвестна (пишем честный 0). */
export async function estimateCostUsd(
  provider: AiProviderId | undefined,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): Promise<number | null> {
  // Без явного провайдера — эвристика по форме id (яндексовые URI уникальны).
  if (!provider && (modelId.startsWith('gpt://') || modelId.startsWith('emb://'))) provider = 'yandex'
  if (provider === 'yandex' || provider === 'gigachat') {
    return estimateRubModelCostUsd(await getPriceBook(), provider, modelId, inputTokens, outputTokens)
  }
  if (provider === 'selectel') {
    const price = await selectelPriceRub(modelId)
    if (!price) return null
    // Каталог Selectel отдаёт ₽ за ОДИН токен.
    return (inputTokens * price[0] + outputTokens * price[1]) / rubPerUsdOf(await getPriceBook())
  }
  return null // openrouter: точный cost приходит из API, оценка не нужна
}

/** Курс ₽/$ стенда — для мест, которые показывают наш USD-расход в рублях. */
export async function rubPerUsd(): Promise<number> {
  return rubPerUsdOf(await getPriceBook())
}
