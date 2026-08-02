import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { estimateCostUsd } from '@/shared/ai/pricing'
import { clearPriceBookCache } from '@/shared/ai/price-book'

/**
 * Цены RU-провайдеров переехали из таблиц в коде в прайс-книгу (данные стенда). Здесь
 * проверяется то, что от этого переезда НЕ должно было измениться: денежная оценка вызова.
 * Без неё Яндекс- и GigaChat-вызовы пишутся с cost=0, и денежные лимиты не срабатывают вовсе.
 */
let savedRate: string | undefined
beforeEach(() => {
  savedRate = process.env.SETFORK_RUB_PER_USD
  process.env.SETFORK_RUB_PER_USD = '100' // круглый курс для читаемых ассертов
  clearPriceBookCache()
})
afterEach(() => {
  if (savedRate === undefined) delete process.env.SETFORK_RUB_PER_USD
  else process.env.SETFORK_RUB_PER_USD = savedRate
  clearPriceBookCache()
})

describe('estimateCostUsd', () => {
  it('gigachat: единая цена на вход и выход, семейство Pro дороже Lite', async () => {
    // 1М входа + 1М выхода на Lite = 2 × 65 ₽ = 130 ₽ = $1.3 при курсе 100
    expect(await estimateCostUsd('gigachat', 'GigaChat-2', 1_000_000, 1_000_000)).toBeCloseTo(1.3, 10)
    expect(await estimateCostUsd('gigachat', 'GigaChat-2-Pro', 1_000_000, 0)).toBeCloseTo(5, 10)
    expect(await estimateCostUsd('gigachat', 'GigaChat-2-Max', 1_000_000, 0)).toBeCloseTo(6.5, 10)
  })

  it('неизвестной модели цену НЕ выдумываем — null (честный 0 в журнале)', async () => {
    expect(await estimateCostUsd('gigachat', 'GigaChat-3-Ultra', 1000, 1000)).toBeNull()
    expect(await estimateCostUsd('yandex', 'gpt://b1g/deepseek-v32/latest', 1000, 1000)).toBeNull()
  })

  it('yandex: работает и через эвристику по форме id (без provider)', async () => {
    // yandexgpt-lite 200 ₽ за 1М: 1000+1000 токенов = 0.4 ₽ = $0.004
    expect(await estimateCostUsd(undefined, 'gpt://b1g/yandexgpt-lite/latest', 1000, 1000)).toBeCloseTo(0.004, 10)
    // Дообученная (@tune) тарифицируется как базовая.
    expect(await estimateCostUsd(undefined, 'gpt://b1g/yandexgpt-lite/latest@tune1', 1000, 1000)).toBeCloseTo(0.004, 10)
  })

  it('yandex-эмбеддинги: платим только за вход', async () => {
    // 10.1 ₽ за 1М: 1М входа = 10.1 ₽ = $0.101
    expect(await estimateCostUsd(undefined, 'emb://b1g/text-embeddings-v2-doc/latest', 1_000_000, 0)).toBeCloseTo(0.101, 10)
  })

  it('openrouter/неизвестный провайдер: null (точный cost приходит из API)', async () => {
    expect(await estimateCostUsd('openrouter', 'openai/gpt-4o-mini', 1000, 1000)).toBeNull()
    expect(await estimateCostUsd(undefined, 'openai/gpt-4o-mini', 1000, 1000)).toBeNull()
  })
})
