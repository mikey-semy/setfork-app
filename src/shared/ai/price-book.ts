import 'server-only'
import { getSettings, saveSettings } from '@/shared/settings/kv'
import { prettyModelName } from './model-names'
import seed from './price-book.seed.json'

/**
 * ПРАЙС-КНИГА — цены как ДАННЫЕ, а не как таблица в коде.
 *
 * Почему вообще существует: у Яндекса и GigaChat нет API цен, а без цены вызов пишется с
 * cost=0 и денежные квоты (дневной кап, потолок на пользователя) не срабатывают НИКОГДА.
 * Раньше прайс жил двумя таблицами прямо в модулях (`yandex-pricing`, `pricing`) — то есть
 * менялся деплоем и устаревал молча, ровно как список «совместимых» моделей до него.
 *
 * Теперь источник — запись стенда (app_settings `ai.price_book`), которую правят как данные.
 * В коде остаётся только ПРАВИЛО ВЫВОДА: чем платим, как сопоставляем модель со строкой.
 * Файл-семя (price-book.seed.json) кладётся в запись один раз при первом чтении — иначе
 * переезд обнулил бы стоимость всех RU-вызовов и тихо снял денежные лимиты.
 *
 * Форма записи намеренно совпадает с тем, что мы хотим отдавать наружу как данные списка:
 * когда появится наш API списков, источником станет он, а не файл, — правило чтения не
 * изменится.
 */

export type PriceProvider = 'yandex' | 'gigachat'

export interface PriceEntry {
  provider: PriceProvider
  /** С чем сравниваем: короткое имя модели или кусок её id. */
  match: string
  /** exact — совпадение с коротким именем целиком; contains — вхождение в id или имя. */
  mode: 'exact' | 'contains'
  /** ₽ за 1М токенов входа и выхода. */
  in: number
  out: number
}

export interface PriceBook {
  unit: 'RUB_PER_1M_TOKENS'
  /** Курс для колонки cost_usd. Перебивается env SETFORK_RUB_PER_USD. */
  rubPerUsd: number
  source: string
  updatedAt: string
  entries: PriceEntry[]
}

export const PRICE_BOOK_SETTING = 'ai.price_book'

let cache: { at: number; book: PriceBook } | null = null
const CACHE_TTL_MS = 60_000

export function clearPriceBookCache(): void {
  cache = null
}

function parseBook(raw: string | undefined): PriceBook | null {
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as Partial<PriceBook>
    if (!Array.isArray(j.entries) || !j.rubPerUsd) return null
    return {
      unit: 'RUB_PER_1M_TOKENS',
      rubPerUsd: Number(j.rubPerUsd),
      source: String(j.source ?? ''),
      updatedAt: String(j.updatedAt ?? ''),
      entries: j.entries.filter((e) => e && e.match && Number.isFinite(e.in) && Number.isFinite(e.out)),
    }
  } catch {
    return null // битая запись = знаний нет; семя подставится ниже
  }
}

/** Прайс-книга стенда. Нет записи (или битая) — кладём семя и работаем с ним. */
export async function getPriceBook(): Promise<PriceBook> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.book
  let stored: PriceBook | null = null
  try {
    stored = parseBook((await getSettings([PRICE_BOOK_SETTING]))[PRICE_BOOK_SETTING])
    if (!stored) {
      // Записываем семя, чтобы дальше правились ДАННЫЕ, а не файл в репозитории.
      await saveSettings({ [PRICE_BOOK_SETTING]: JSON.stringify(seed) })
    }
  } catch (e) {
    // База недоступна — считаем по семени. Оценка стоимости не может зависеть от того,
    // доехало ли чтение настроек: на ней стоят денежные лимиты.
    console.warn('[price-book] чтение записи не удалось, беру семя', e instanceof Error ? e.message : e)
  }
  const book = stored ?? (seed as PriceBook)
  cache = { at: Date.now(), book }
  return book
}

export async function savePriceBook(book: PriceBook): Promise<void> {
  await saveSettings({ [PRICE_BOOK_SETTING]: JSON.stringify(book) })
  clearPriceBookCache()
}

/** Курс ₽/$: env стенда важнее записи (её ведут реже, чем меняется курс). */
export function rubPerUsdOf(book: PriceBook): number {
  const env = Number(process.env.SETFORK_RUB_PER_USD)
  return Number.isFinite(env) && env > 0 ? env : book.rubPerUsd
}

/**
 * Цена модели в ₽ за 1М токенов: [вход, выход] или null, если в книге её нет.
 *
 * Порядок строк ЗНАЧИМ — выигрывает первая подошедшая. Так же вели себя прежние таблицы
 * (у GigaChat — массив регулярок, первое совпадение), только теперь порядком управляет тот,
 * кто ведёт данные, а не тот, кто правит код. Неизвестная модель даёт null, а не догадку:
 * выдуманная цена хуже честного нуля, потому что на ней стоят денежные лимиты.
 */
export function priceRub1M(book: PriceBook, provider: PriceProvider, modelId: string): [number, number] | null {
  // Дообученные (name@suffix) и версии в скобках тарифицируются как базовая модель.
  const name = prettyModelName(modelId).replace(/\s*\(.+\)$/, '').split('@')[0]
  for (const e of book.entries) {
    if (e.provider !== provider) continue
    const hit = e.mode === 'exact' ? name === e.match : modelId.includes(e.match) || name.includes(e.match)
    if (hit) return [e.in, e.out]
  }
  return null
}

/** Оценка стоимости вызова в USD или null, если цены нет. */
export function estimateRubModelCostUsd(
  book: PriceBook,
  provider: PriceProvider,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = priceRub1M(book, provider, modelId)
  if (!price) return null
  const rub = (inputTokens / 1_000_000) * price[0] + (outputTokens / 1_000_000) * price[1]
  return rub / rubPerUsdOf(book)
}
