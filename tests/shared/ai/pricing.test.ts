import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { estimateCostUsd, gigachatPriceRub1M } from '@/shared/ai/pricing'

let savedRate: string | undefined
beforeEach(() => {
  savedRate = process.env.SETFORK_RUB_PER_USD
  process.env.SETFORK_RUB_PER_USD = '100' // круглый курс для читаемых ассертов
})
afterEach(() => {
  if (savedRate === undefined) delete process.env.SETFORK_RUB_PER_USD
  else process.env.SETFORK_RUB_PER_USD = savedRate
})

describe('gigachatPriceRub1M', () => {
  it('семейства Lite/Pro/Max, preview тарифицируется как базовая', () => {
    expect(gigachatPriceRub1M('GigaChat')).toBe(65)
    expect(gigachatPriceRub1M('GigaChat-2')).toBe(65)
    expect(gigachatPriceRub1M('GigaChat-2-Pro')).toBe(500)
    expect(gigachatPriceRub1M('GigaChat-Pro-preview')).toBe(500)
    expect(gigachatPriceRub1M('GigaChat-2-Max')).toBe(650)
    expect(gigachatPriceRub1M('Embeddings-2')).toBe(14)
  })

  it('неизвестные (GigaChat-3-Ultra, Plus) → null', () => {
    expect(gigachatPriceRub1M('GigaChat-3-Ultra')).toBeNull()
    expect(gigachatPriceRub1M('GigaChat-Plus')).toBeNull()
  })
})

describe('estimateCostUsd', () => {
  it('gigachat: единая цена на вход и выход', async () => {
    // 1М входа + 1М выхода на Lite = 2 × 65 ₽ = 130 ₽ = $1.3 при курсе 100
    expect(await estimateCostUsd('gigachat', 'GigaChat-2', 1_000_000, 1_000_000)).toBeCloseTo(1.3, 10)
    expect(await estimateCostUsd('gigachat', 'GigaChat-3-Ultra', 1000, 1000)).toBeNull()
  })

  it('yandex: работает и через эвристику по форме id (без provider)', async () => {
    // yandexgpt-lite 0.2/0.2 ₽ за 1k: 1000+1000 токенов = 0.4 ₽ = $0.004
    expect(await estimateCostUsd(undefined, 'gpt://b1g/yandexgpt-lite/latest', 1000, 1000)).toBeCloseTo(0.004, 10)
  })

  it('openrouter/неизвестный провайдер: null (точный cost приходит из API)', async () => {
    expect(await estimateCostUsd('openrouter', 'openai/gpt-4o-mini', 1000, 1000)).toBeNull()
    expect(await estimateCostUsd(undefined, 'openai/gpt-4o-mini', 1000, 1000)).toBeNull()
  })
})
