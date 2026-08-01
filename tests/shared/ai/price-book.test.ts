import { describe, expect, it } from 'vitest'
import { estimateRubModelCostUsd, parsePriceStep, priceBookFromList, priceRub1M, rubPerUsdOf, type PriceBook } from '@/shared/ai/price-book'
import seed from '@/shared/ai/price-book.seed.json'

/**
 * Прайс-книга: цены — ДАННЫЕ, в коде остаётся только правило вывода. Проверяем именно правило,
 * на своём наборе строк, чтобы тест не падал каждый раз, когда владелец правит цену.
 */
const BOOK: PriceBook = {
  unit: 'RUB_PER_1M_TOKENS',
  rubPerUsd: 100,
  source: 'тест',
  updatedAt: '2026-08-01',
  entries: [
    { provider: 'yandex', match: 'lite', mode: 'exact', in: 200, out: 300 },
    { provider: 'yandex', match: 'emb://', mode: 'contains', in: 10, out: 0 },
    { provider: 'gigachat', match: '-Pro', mode: 'contains', in: 500, out: 500 },
    { provider: 'gigachat', match: 'Giga', mode: 'exact', in: 65, out: 65 },
  ],
}

describe('priceRub1M: правило сопоставления модели со строкой прайса', () => {
  it('exact — по короткому имени целиком, версия и дообучение отбрасываются', () => {
    expect(priceRub1M(BOOK, 'yandex', 'gpt://b1g/lite/latest')).toEqual([200, 300])
    expect(priceRub1M(BOOK, 'yandex', 'gpt://b1g/lite/latest@tune7')).toEqual([200, 300])
  })

  it('contains — по куску id (эмбеддинги Яндекса опознаются по схеме URI)', () => {
    expect(priceRub1M(BOOK, 'yandex', 'emb://b1g/text-embeddings-v2-doc/latest')).toEqual([10, 0])
  })

  it('выигрывает ПЕРВАЯ подошедшая строка — порядком управляет тот, кто ведёт данные', () => {
    // '-Pro' стоит выше 'Giga', поэтому Pro-модель тарифицируется как Pro, а не как Lite.
    expect(priceRub1M(BOOK, 'gigachat', 'Giga-Pro')).toEqual([500, 500])
    expect(priceRub1M(BOOK, 'gigachat', 'Giga')).toEqual([65, 65])
  })

  it('чужой провайдер и неизвестная модель → null, а не догадка', () => {
    expect(priceRub1M(BOOK, 'gigachat', 'gpt://b1g/lite/latest')).toBeNull()
    expect(priceRub1M(BOOK, 'yandex', 'gpt://b1g/unknown-model/latest')).toBeNull()
  })
})

describe('rubPerUsdOf: курс стенда важнее записи', () => {
  it('env перебивает значение из книги', () => {
    const saved = process.env.SETFORK_RUB_PER_USD
    delete process.env.SETFORK_RUB_PER_USD
    expect(rubPerUsdOf(BOOK)).toBe(100)
    process.env.SETFORK_RUB_PER_USD = '80'
    expect(rubPerUsdOf(BOOK)).toBe(80)
    if (saved === undefined) delete process.env.SETFORK_RUB_PER_USD
    else process.env.SETFORK_RUB_PER_USD = saved
  })
})

describe('estimateRubModelCostUsd', () => {
  it('считает по ₽/1М и переводит в доллары', () => {
    // 1М входа × 200 ₽ + 2М выхода × 300 ₽ = 800 ₽ = $8 при курсе 100
    expect(estimateRubModelCostUsd(BOOK, 'yandex', 'gpt://b1g/lite/latest', 1_000_000, 2_000_000)).toBeCloseTo(8, 10)
  })
})

/**
 * Семя — это ДАННЫЕ переезда: оно должно оставаться разбираемым и покрывать те модели,
 * ради которых прайс вообще заводился. Иначе «убрали константы» тихо означало бы
 * «перестали считать деньги по RU-провайдерам».
 */
describe('семя прайс-книги', () => {
  const book = seed as PriceBook

  it('форма верна и единица одна на всю книгу', () => {
    expect(book.unit).toBe('RUB_PER_1M_TOKENS')
    expect(book.rubPerUsd).toBeGreaterThan(0)
    expect(book.entries.length).toBeGreaterThan(0)
    for (const e of book.entries) {
      expect(['yandex', 'gigachat']).toContain(e.provider)
      expect(['exact', 'contains']).toContain(e.mode)
      expect(Number.isFinite(e.in) && Number.isFinite(e.out)).toBe(true)
    }
  })

  it('модели, на которых стенд реально работает, тарифицируются', () => {
    expect(priceRub1M(book, 'yandex', 'gpt://b1g/yandexgpt-5.1/latest')).toEqual([800, 800])
    expect(priceRub1M(book, 'yandex', 'emb://b1g/text-embeddings-v2-doc/latest')).toEqual([10.1, 0])
    expect(priceRub1M(book, 'gigachat', 'GigaChat-2')).toEqual([65, 65])
    expect(priceRub1M(book, 'gigachat', 'GigaChat-2-Max')).toEqual([650, 650])
  })
})

/**
 * ПРАЙС ИЗ НАШЕГО ЖЕ СПИСКА. Строка списка читается и человеком, и кодом: заголовок — то, с
 * чем сравниваем, описание — «провайдер · режим · вход / выход». Значения НЕ выводятся из
 * секции и не угадываются по красивому названию: человеческое «GigaChat Pro» сопоставляется
 * с куском id «-Pro», и одно из другого не выводится.
 */
describe('parsePriceStep: строка списка → строка прайса', () => {
  it('разбирает машинную часть описания', () => {
    expect(parsePriceStep('yandexgpt-5.1', 'yandex · exact · 800 / 800')).toEqual({
      provider: 'yandex', match: 'yandexgpt-5.1', mode: 'exact', in: 800, out: 800,
    })
    expect(parsePriceStep('-Pro', 'gigachat · contains · 500 / 500')).toEqual({
      provider: 'gigachat', match: '-Pro', mode: 'contains', in: 500, out: 500,
    })
    expect(parsePriceStep('emb://', 'yandex · contains · 10.1 / 0')?.in).toBe(10.1)
  })

  it('мусор не превращается в цену — null, а не догадка', () => {
    expect(parsePriceStep('модель', '800 ₽ вход · 800 ₽ выход')).toBeNull() // старый прозаический вид
    expect(parsePriceStep('модель', 'openai · exact · 1 / 1')).toBeNull() // чужой провайдер
    expect(parsePriceStep('модель', 'yandex · regex · 1 / 1')).toBeNull() // неизвестный режим
    expect(parsePriceStep('', 'yandex · exact · 1 / 1')).toBeNull() // не с чем сравнивать
    expect(parsePriceStep('м', 'yandex · exact · дорого / 1')).toBeNull() // цена не число
    expect(parsePriceStep('м', 'yandex · exact · -5 / 1')).toBeNull() // отрицательная цена
  })
})

describe('priceBookFromList: конверт списка → книга', () => {
  const base: PriceBook = { unit: 'RUB_PER_1M_TOKENS', rubPerUsd: 90, source: '', updatedAt: '', entries: [] }

  it('порядок строк сохраняется — он и есть приоритет', () => {
    const env = {
      version: 2,
      updatedAt: '2026-08-01T10:00:00.000Z',
      steps: [
        { title: 'вступление', desc: '' },
        { title: '-Pro', desc: 'gigachat · contains · 500 / 500' },
        { title: 'GigaChat-2', desc: 'gigachat · exact · 65 / 65' },
      ],
    }
    const book = priceBookFromList(env, base)!
    expect(book.entries.map((e) => e.match)).toEqual(['-Pro', 'GigaChat-2'])
    expect(book.updatedAt).toBe('2026-08-01T10:00:00.000Z')
    // Тариф семейства выигрывает у общего имени — ровно потому, что стоит выше.
    expect(priceRub1M(book, 'gigachat', 'GigaChat-2-Pro')).toEqual([500, 500])
    expect(priceRub1M(book, 'gigachat', 'GigaChat-2')).toEqual([65, 65])
  })

  it('ни одной разобранной строки → null: пустая книга сняла бы денежные лимиты', () => {
    expect(priceBookFromList({ steps: [{ title: 'привет', desc: 'просто текст' }] }, base)).toBeNull()
    expect(priceBookFromList({}, base)).toBeNull()
  })
})
