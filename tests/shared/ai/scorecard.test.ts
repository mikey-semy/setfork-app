import { describe, expect, it } from 'vitest'
import { byStrength, decidable, scorecardOf, MIN_ATTEMPTS, type Axes } from '@/shared/ai/scorecard'

// Скоркарт в shadow-режиме. Тесты держат ровно то, ради чего он такой:
// одна ось не даёт ранжировать, доверие не переносится в домен без прямых попыток, и
// кадровое решение упирается в явную проверку, а не в сравнение чисел.

const axes = (over: Partial<Axes> = {}): Axes => ({
  attempts: 10,
  acceptedShare: 4,
  uniqueFacets: 20,
  deliveredFacets: 12,
  facetRuns: 6,
  ...over,
})

describe('zero-evidence gate', () => {
  it('в домене без попыток — «нет оснований», а не ноль и не средний по гному', () => {
    const s = scorecardOf(axes({ attempts: 0, acceptedShare: 0, uniqueFacets: 0, deliveredFacets: 0, facetRuns: 0 }))
    expect(s.verdict).toBe('no-evidence')
    expect(s.acceptance).toBeNull()
    expect(s.facetDelivery).toBeNull()
    expect(decidable(s)).toBe(false)
  })

  it('ноль принятого при попытках — это НЕ «нет оснований», а честный нуль', () => {
    const s = scorecardOf(axes({ acceptedShare: 0 }))
    expect(s.verdict).toBe('rankable')
    expect(s.acceptance).toBe(0)
  })
})

describe('две оси обязательны', () => {
  it('есть приёмка, нет многогранности — ранжировать нельзя', () => {
    const s = scorecardOf(axes({ uniqueFacets: 0, deliveredFacets: 0, facetRuns: 0 }))
    expect(s.verdict).toBe('one-axis-only')
    expect(s.why).toContain('многогранности')
    expect(decidable(s)).toBe(false)
  })

  it('есть многогранность, нет приёмки — тоже нельзя', () => {
    const s = scorecardOf(axes({ attempts: 0, acceptedShare: 0 }))
    expect(s.verdict).toBe('one-axis-only')
    expect(s.why).toContain('приёмке')
  })

  it('обе оси наполнены — можно ранжировать, и обе доли посчитаны', () => {
    const s = scorecardOf(axes())
    expect(s.verdict).toBe('rankable')
    expect(s.acceptance).toBeCloseTo(0.4)
    expect(s.facetDelivery).toBeCloseTo(0.6)
    expect(decidable(s)).toBe(true)
  })
})

describe('тонкие данные', () => {
  it(`меньше ${MIN_ATTEMPTS} попыток — показываем, но решений не принимаем`, () => {
    const s = scorecardOf(axes({ attempts: 3, acceptedShare: 2 }))
    expect(s.verdict).toBe('thin')
    expect(s.acceptance).toBeCloseTo(2 / 3) // цифра есть…
    expect(decidable(s)).toBe(false) // …но решение по ней запрещено
  })
})

describe('порядок показа', () => {
  it('сначала те, по кому есть основания; внутри — по приёмке', () => {
    const strong = scorecardOf(axes({ acceptedShare: 8 }))
    const weak = scorecardOf(axes({ acceptedShare: 1 }))
    const thin = scorecardOf(axes({ attempts: 2, acceptedShare: 2 }))
    const none = scorecardOf(axes({ attempts: 0, acceptedShare: 0, uniqueFacets: 0, deliveredFacets: 0, facetRuns: 0 }))
    const sorted = [none, thin, weak, strong].sort(byStrength)
    expect(sorted.map((s) => s.verdict)).toEqual(['rankable', 'rankable', 'thin', 'no-evidence'])
    expect(sorted[0].acceptance).toBeGreaterThan(sorted[1].acceptance!)
  })
})
