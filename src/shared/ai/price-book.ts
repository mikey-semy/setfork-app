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
/** Ссылки на СПИСКИ SetFork с прайсом: `handle/slug`, через запятую. Пусто = запись стенда.
 *  Списков несколько, потому что справочник ведётся ПО ИСТОЧНИКУ: у Яндекса и Сбера разные
 *  прайс-страницы, разный темп изменений и разные даты проверки — в одном списке они бы
 *  делили одну отметку свежести, и было бы не видно, чьи цифры протухли. */
export const PRICE_BOOK_SOURCE_SETTING = 'ai.price_book_source'

/**
 * СТРОКА ПРАЙСА В СПИСКЕ: заголовок шага — то, с чем сравниваем, описание — машинная часть
 * `провайдер · режим · вход / выход`. Формат выбран так, чтобы одна и та же строка читалась
 * и человеком, и кодом: значения не выводятся ни из секции, ни из красивого названия —
 * иначе пришлось бы угадывать (у GigaChat человеческое «GigaChat Pro» сопоставляется с
 * куском id «-Pro», и вывести одно из другого нельзя).
 *
 * Строка, которая не разобралась, ПРОПУСКАЕТСЯ с предупреждением: выдуманная цена хуже
 * отсутствующей, потому что на этих числах стоят денежные лимиты.
 */
export function parsePriceStep(title: string, desc: string): PriceEntry | null {
  const parts = (desc || '').split('·').map((x) => x.trim())
  if (parts.length < 3) return null
  const [provider, mode, prices] = parts
  if (provider !== 'yandex' && provider !== 'gigachat') return null
  if (mode !== 'exact' && mode !== 'contains') return null
  const [inRaw, outRaw] = prices.split('/').map((x) => Number(x.trim().replace(',', '.')))
  const match = (title || '').trim()
  if (!match || !Number.isFinite(inRaw) || !Number.isFinite(outRaw) || inRaw < 0 || outRaw < 0) return null
  return { provider, match, mode, in: inRaw, out: outRaw }
}

/** Конверт data.json → прайс-книга. Порядок строк СОХРАНЯЕТСЯ: он и есть приоритет. */
export function priceBookFromList(
  envelope: { steps?: { title?: string; desc?: string }[]; version?: number; updatedAt?: string },
  base: PriceBook,
): PriceBook | null {
  const entries: PriceEntry[] = []
  for (const s of envelope.steps ?? []) {
    const e = parsePriceStep(s.title ?? '', s.desc ?? '')
    if (e) entries.push(e)
    else if ((s.desc ?? '').includes('·')) console.warn(`[price-book] строка «${s.title}» не разобрана — пропущена`)
  }
  if (!entries.length) return null
  return { ...base, entries, source: `список v${envelope.version ?? '?'}`, updatedAt: envelope.updatedAt ?? base.updatedAt }
}

let cache: { at: number; book: PriceBook } | null = null
const CACHE_TTL_MS = 60_000

/**
 * Прайс ИЗ НАШЕГО ЖЕ СПИСКА — тем самым транспортом, которым его получит любой чужой
 * потребитель (`/{handle}/{slug}/data.json`). Это не украшение: пока мы читаем свой продукт
 * тем же способом, что и посторонние, транспорт не может тихо сломаться незамеченным.
 *
 * Недоступен (не задан, не задеплоен, сеть, приватный) → null, и выше берётся запись стенда,
 * а за ней семя. Денежные лимиты не имеют права зависеть от доступности одной страницы.
 */
async function priceBookFromSource(refs: string | undefined, base: PriceBook): Promise<PriceBook | null> {
  const paths = (refs ?? '')
    .split(',')
    .map((r) => r.trim().replace(/^\/+|\/+$/g, ''))
    .filter((p) => /^[^/]+\/[^/]+$/.test(p))
  if (!paths.length) return null
  const origin = (process.env.APP_URL || process.env.SETFORK_APP_URL || '').replace(/\/$/, '')
  if (!origin) return null
  // Списки независимы — тянем ОДНОВРЕМЕННО, а складываем строго в порядке ссылок: порядок
  // задаёт приоритет строк, и терять его из-за того, кто первым ответил, нельзя.
  const loaded = await Promise.all(
    paths.map(async (path) => {
      try {
        const res = await fetch(`${origin}/${path}/data.json`, { signal: AbortSignal.timeout(8_000), cache: 'no-store' })
        if (!res.ok) {
          console.warn(`[price-book] список ${path} не отдал данные: HTTP ${res.status}`)
          return null
        }
        const part = priceBookFromList(await res.json(), base)
        return part ? { path, part } : null
      } catch (e) {
        console.warn(`[price-book] список ${path} недоступен:`, e instanceof Error ? e.message : e)
        return null
      }
    }),
  )
  const entries: PriceEntry[] = []
  const seen: string[] = []
  for (const item of loaded) {
    if (!item) continue
    entries.push(...item.part.entries)
    seen.push(`${item.path} (${item.part.source})`)
  }
  if (!entries.length) return null
  return { ...base, entries, source: seen.join(' + ') }
}

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
    const m = await getSettings([PRICE_BOOK_SETTING, PRICE_BOOK_SOURCE_SETTING])
    stored = parseBook(m[PRICE_BOOK_SETTING])
    // Источник-СПИСОК важнее записи: это и есть свой продукт в работе — прайс ведут как
    // список, код читает его тем же транспортом, что и любой чужой потребитель.
    // env как запасной путь: источник можно включить на стенде до появления поля в админке.
    const sourceRef = m[PRICE_BOOK_SOURCE_SETTING] || process.env.SETFORK_PRICE_BOOK_SOURCE
    const fromList = await priceBookFromSource(sourceRef, stored ?? (seed as PriceBook))
    if (fromList) {
      cache = { at: Date.now(), book: fromList }
      return fromList
    }
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
