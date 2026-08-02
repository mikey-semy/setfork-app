import { describe, expect, it } from 'vitest'
import { healthy } from '@/shared/ai/credits'
import type { ModelOption } from '@/shared/ai/models'

/**
 * КАРАНТИН И ДЛЯ ОДИНОЧНОЙ ГЕНЕРАЦИИ. Механизм существовал только для пула совета: модель с
 * проседающим успехом оставалась основной моделью обычной генерации, пока владелец не заметит
 * и не сменит руками. Правило замены зафиксировано тестом, потому что оно про деньги и качество.
 */
const m = (id: string, price: number): ModelOption => ({
  id,
  name: id,
  label: id,
  family: id.split('/')[0],
  priceKnown: true,
  promptPrice: price,
  completionPrice: price,
  contextLength: 128_000,
  structured: true,
  intelligence: 0,
})

const CATALOG = [m('a/cheap', 0.1), m('b/mid', 1), m('c/pricey', 5)]

describe('healthy: чем заменить модель в карантине', () => {
  it('модель здорова — не трогаем', () => {
    expect(healthy('b/mid', 'a/cheap', CATALOG, new Set())).toBe('b/mid')
  })

  it('в карантине → сперва НАЗНАЧЕННАЯ запасная (это выбор владельца)', () => {
    expect(healthy('b/mid', 'c/pricey', CATALOG, new Set(['b/mid']))).toBe('c/pricey')
  })

  it('запасная тоже в карантине → самая дешёвая здоровая из каталога', () => {
    expect(healthy('b/mid', 'c/pricey', CATALOG, new Set(['b/mid', 'c/pricey']))).toBe('a/cheap')
  })

  it('запасной нет в каталоге — она не годится в замену (это был бы 404)', () => {
    expect(healthy('b/mid', 'ghost/model', CATALOG, new Set(['b/mid']))).toBe('a/cheap')
  })

  it('все в карантине → работаем на исходной: медленная генерация лучше отсутствующей', () => {
    expect(healthy('b/mid', '', CATALOG, new Set(['a/cheap', 'b/mid', 'c/pricey']))).toBe('b/mid')
  })

  it("':online' — та же модель: карантин снимается по базовому id", () => {
    expect(healthy('b/mid:online', 'a/cheap', CATALOG, new Set(['b/mid']))).toBe('a/cheap')
  })
})
