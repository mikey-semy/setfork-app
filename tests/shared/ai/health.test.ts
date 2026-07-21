import { describe, expect, it } from 'vitest'
import { baseModelId, filterByQuarantine, isQuarantined, QUARANTINE_MIN_CALLS } from '@/shared/ai/health'

const h = (model: string, calls: number, okRate: number) => ({ model, calls, okRate, p95Ms: 0 })

describe('isQuarantined', () => {
  it('мало вызовов — не статистика, карантина нет даже при нулевом успехе', () => {
    expect(isQuarantined(h('m', QUARANTINE_MIN_CALLS - 1, 0))).toBe(false)
  })

  it('достаточно вызовов и успех ниже порога → карантин', () => {
    expect(isQuarantined(h('m', QUARANTINE_MIN_CALLS, 0.85))).toBe(true)
    expect(isQuarantined(h('m', 100, 0.95))).toBe(false)
  })
})

describe('baseModelId', () => {
  it(':online-суффикс срезается, прочее не трогаем', () => {
    expect(baseModelId('openai/gpt-4o-mini:online')).toBe('openai/gpt-4o-mini')
    expect(baseModelId('gpt://b1g/yandexgpt-5.1/latest')).toBe('gpt://b1g/yandexgpt-5.1/latest')
  })
})

describe('filterByQuarantine', () => {
  const q = new Set(['bad/model'])

  it('карантинные выпадают (в т.ч. их :online-вариант)', () => {
    expect(filterByQuarantine(['good/a', 'bad/model', 'bad/model:online'], q)).toEqual(['good/a'])
  })

  it('если выпали все — возвращаем исходный список (совет важнее кары)', () => {
    expect(filterByQuarantine(['bad/model'], q)).toEqual(['bad/model'])
  })

  it('пустой вход — пустой выход', () => {
    expect(filterByQuarantine([], q)).toEqual([])
  })
})
