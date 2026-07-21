import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { estimateYandexCostUsd, rubPerUsd, yandexPriceRub } from '@/shared/ai/yandex-pricing'

let savedRate: string | undefined
beforeEach(() => {
  savedRate = process.env.SETFORK_RUB_PER_USD
  delete process.env.SETFORK_RUB_PER_USD
})
afterEach(() => {
  if (savedRate === undefined) delete process.env.SETFORK_RUB_PER_USD
  else process.env.SETFORK_RUB_PER_USD = savedRate
})

describe('yandexPriceRub', () => {
  it('известные модели по короткому имени из URI, версия/дообучение не мешают', () => {
    expect(yandexPriceRub('gpt://b1g/yandexgpt-5.1/latest')).toEqual([0.8, 0.8])
    expect(yandexPriceRub('gpt://b1g/aliceai-llm-flash/latest')).toEqual([0.1, 0.2])
    expect(yandexPriceRub('gpt://b1g/yandexgpt-lite/rc')).toEqual([0.2, 0.2])
    expect(yandexPriceRub('gpt://b1g/yandexgpt-lite/latest@tune1')).toEqual([0.2, 0.2])
  })

  it('эмбеддинги — единая цена, вход-only', () => {
    expect(yandexPriceRub('emb://b1g/text-embeddings-v2-doc/latest')).toEqual([0.0101, 0])
  })

  it('неизвестная модель и не-яндексовые id → null', () => {
    expect(yandexPriceRub('gpt://b1g/deepseek-v32/latest')).toBeNull()
    expect(yandexPriceRub('openai/gpt-4o-mini')).toBeNull()
  })
})

describe('estimateYandexCostUsd', () => {
  it('считает по прайсу и курсу (дефолт 90 ₽/$)', () => {
    // yandexgpt-5.1: 1000 вх + 1000 исх = 0.8 + 0.8 = 1.6 ₽ = 1.6/90 $
    expect(estimateYandexCostUsd('gpt://b1g/yandexgpt-5.1/latest', 1000, 1000)).toBeCloseTo(1.6 / 90, 10)
  })

  it('курс переопределяется env', () => {
    process.env.SETFORK_RUB_PER_USD = '80'
    expect(rubPerUsd()).toBe(80)
    expect(estimateYandexCostUsd('gpt://b1g/yandexgpt-lite/latest', 2000, 0)).toBeCloseTo(0.4 / 80, 10)
  })

  it('нет цены → null (честный 0 у вызывающего, не выдуманная цифра)', () => {
    expect(estimateYandexCostUsd('gpt://b1g/deepseek-v32/latest', 1000, 1000)).toBeNull()
  })
})
