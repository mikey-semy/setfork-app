import 'server-only'
import type { AiProviderId } from '@/shared/settings/ai'
import { estimateYandexCostUsd, rubPerUsd, yandexPriceRub } from './yandex-pricing'

// Единая оценка стоимости вызова по ЛЮБОМУ провайдеру (для колонки cost_usd —
// на ней держатся денежные квоты и дашборд расхода):
// - openrouter: cost приходит в ответе API (extractUsage) — оценка не нужна;
// - yandex: хардкод-прайс (yandex-pricing, API цен не отдаёт);
// - gigachat: хардкод-прайс физлиц-тарифа (₽/1М, вход=выход единая);
// - selectel: цены ЕСТЬ в их /models (₽/токен) — кешируем каталог и считаем.
// Нет цены → null (честный 0 у вызывающего, не выдуманная цифра).

// GigaChat, ₽ за 1М токенов (developers.sber.ru → tariffs/individual-tariffs,
// 2026-07-21; вход и выход тарифицируются одинаково). Семейство определяет цену:
// GigaChat-2-Pro-preview тарифицируется как Pro. GigaChat-3-Ultra в прайсе
// пакетов нет — цена неизвестна.
const GIGACHAT_RUB_PER_1M: Array<[RegExp, number]> = [
  [/^GigaChat(-2)?(-preview)?$/, 65], // Lite
  [/-Pro(-preview)?$/, 500],
  [/-Max(-preview)?$/, 650],
  [/^Embeddings/, 14],
]

export function gigachatPriceRub1M(modelId: string): number | null {
  for (const [re, price] of GIGACHAT_RUB_PER_1M) if (re.test(modelId)) return price
  return null
}

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
  if (provider === 'yandex') return estimateYandexCostUsd(modelId, inputTokens, outputTokens)
  if (provider === 'gigachat') {
    const price = gigachatPriceRub1M(modelId)
    if (price == null) return null
    return (((inputTokens + outputTokens) / 1_000_000) * price) / rubPerUsd()
  }
  if (provider === 'selectel') {
    const price = await selectelPriceRub(modelId)
    if (!price) return null
    // Каталог Selectel отдаёт ₽ за ОДИН токен.
    return (inputTokens * price[0] + outputTokens * price[1]) / rubPerUsd()
  }
  return null // openrouter: точный cost приходит из API, оценка не нужна
}

export { rubPerUsd, yandexPriceRub }
