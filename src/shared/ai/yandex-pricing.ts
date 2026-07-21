// Прайс Yandex AI Studio (синхрон, ₽/1000 токенов, вкл. НДС) — API цен не отдаёт,
// таблица от владельца 2026-07-21 (источник: aistudio.yandex.ru → Model Gallery,
// копия в setfork-hq/research/2026-07-21-ru-llm-providers.md). Оживляет денежные
// квоты (глобальный кап, потолок $/юзер/мес) и ₽-цены в админ-селектах: без неё
// Яндекс-вызовы писались с cost=0 и лимиты не срабатывали НИКОГДА.
// Курс для колонки cost_usd — env SETFORK_RUB_PER_USD (дефолт 90).
import { prettyModelName } from './models'

/** ₽ за 1000 токенов: [вход, выход]. Ключ — короткое имя модели (prettyModelName). */
const RUB_PER_1K: Record<string, [number, number]> = {
  'aliceai-llm': [0.5, 1.2],
  'aliceai-llm-flash': [0.1, 0.2],
  'yandexgpt-5.1': [0.8, 0.8],
  'yandexgpt-5-pro': [1.2, 1.2],
  yandexgpt: [1.2, 1.2], // алиас Pro
  'yandexgpt-lite': [0.2, 0.2],
  'yandexgpt-5-lite': [0.2, 0.2],
  'deepseek-v4-flash': [0.3, 0.5],
  'qwen3-235b-a22b-fp8': [0.5, 0.5],
  'gpt-oss-120b': [0.3, 0.3],
  'gpt-oss-20b': [0.1, 0.1],
  'qwen3.6-35b-a3b': [0.2, 0.3],
  // deepseek-v32 в прайсе синхрона НЕТ — цена неизвестна, cost не считаем.
}

/** Эмбеддинги: единая цена за 1000 токенов векторизации. */
const EMBED_RUB_PER_1K = 0.0101

export function rubPerUsd(): number {
  const n = Number(process.env.SETFORK_RUB_PER_USD)
  return Number.isFinite(n) && n > 0 ? n : 90
}

/** ₽-прайс модели за 1000 токенов ([вход, выход]) или null, если не знаем. */
export function yandexPriceRub(modelId: string): [number, number] | null {
  if (modelId.startsWith('emb://')) return [EMBED_RUB_PER_1K, 0]
  if (!modelId.startsWith('gpt://')) return null
  // Дообученные (name@suffix) тарифицируются как базовая модель.
  const name = prettyModelName(modelId).replace(/\s*\(.+\)$/, '').split('@')[0]
  return RUB_PER_1K[name] ?? null
}

/** Оценка стоимости вызова в USD (для колонки cost_usd) или null, если цены нет. */
export function estimateYandexCostUsd(modelId: string, inputTokens: number, outputTokens: number): number | null {
  const price = yandexPriceRub(modelId)
  if (!price) return null
  const rub = (inputTokens / 1000) * price[0] + (outputTokens / 1000) * price[1]
  return rub / rubPerUsd()
}
