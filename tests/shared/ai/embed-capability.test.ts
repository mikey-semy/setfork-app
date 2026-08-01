import { describe, expect, it } from 'vitest'
import { capKey, fitOf } from '@/shared/ai/embed-capability'
import { COLUMN_DIM } from '@/shared/ai/embed-space'

/**
 * Совместимость эмбеддинг-модели — ИЗМЕРЕННЫЙ факт, а не список «известных» моделей в коде.
 *
 * История: сначала табличка на три модели, потом регулярка по имени вендора. Оба варианта
 * устаревали молча — из 31 модели каталога владельцу предлагали две, а подпись поля называла
 * чужую мерность. Здесь фиксируется правило вывода: что делать с ответом провайдера, зная
 * ТОЛЬКО ширину колонки (её читаем из схемы) и длину пришедшего вектора.
 */
describe('fitOf: как измеренная мерность ляжет в колонку', () => {
  it('ширина колонки известна из схемы, а не задана в тесте числом', () => {
    expect(COLUMN_DIM).toBeGreaterThan(0)
  })

  it('ровно ширина колонки → точное совпадение', () => {
    expect(fitOf(COLUMN_DIM)).toBe('exact')
  })

  it('длиннее → усечение (о качестве говорим вслух), короче → паддинг', () => {
    expect(fitOf(COLUMN_DIM * 2)).toBe('truncated')
    expect(fitOf(COLUMN_DIM + 1)).toBe('truncated')
    expect(fitOf(COLUMN_DIM - 1)).toBe('padded')
    expect(fitOf(Math.floor(COLUMN_DIM / 3))).toBe('padded')
  })
})

describe('capKey: факт привязан к провайдеру, а не только к имени модели', () => {
  it('одинаковое имя у разных провайдеров — разные записи', () => {
    expect(capKey('openrouter', 'm')).not.toBe(capKey('yandex', 'm'))
  })
})
