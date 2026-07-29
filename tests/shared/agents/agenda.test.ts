import { describe, expect, it } from 'vitest'
import { KIND_WEIGHT, agendaKey, agendaLabel, coverageStrength, rankAgenda, type AgendaSignal } from '@/shared/agents/agenda'

// Повестка развития: ранжир считается КОДОМ из чисел. Тесты держат три свойства, каждое
// против конкретного способа получить бесполезную повестку.

const sig = (kind: AgendaSignal['kind'], domain: string, strength: number): AgendaSignal => ({ kind, domain, strength, why: {} })

describe('ранжир повестки', () => {
  it('вес класса решает при равной остроте: стратегия выше спроса, пока трафика мало', () => {
    const [first] = rankAgenda([sig('demand', '', 1), sig('deepen', 'devops', 1)])
    expect(first.kind).toBe('deepen')
    expect(KIND_WEIGHT.deepen).toBeGreaterThan(KIND_WEIGHT.demand)
  })

  it('собственные нужды не тонут: починка качества обходит слабый сигнал развития', () => {
    const [first] = rankAgenda([sig('deepen', 'devops', 0.2), sig('quality', 'кулинария', 1)])
    expect(first.kind).toBe('quality')
  })

  it('дубль по паре «класс + тема» схлопывается в более острый', () => {
    const out = rankAgenda([sig('deepen', 'devops', 0.3), sig('deepen', 'DevOps', 0.9)])
    expect(out).toHaveLength(1)
    expect(out[0].strength).toBe(0.9)
  })

  it('порядок детерминирован: равный счёт не переставляет пункты от прогона к прогону', () => {
    const s = [sig('deepen', 'b', 0.5), sig('deepen', 'a', 0.5)]
    expect(rankAgenda(s).map((i) => i.domain)).toEqual(rankAgenda([...s].reverse()).map((i) => i.domain))
  })

  it('сила за пределами [0..1] не пускается: один шумный сигнал не перевесит повестку', () => {
    const [first] = rankAgenda([sig('demand', '', 99)])
    expect(first.score).toBeLessThanOrEqual(KIND_WEIGHT.demand)
  })

  it('нулевая острота в повестку не попадает — это не пункт, а шум', () => {
    expect(rankAgenda([sig('deepen', 'devops', 0)])).toEqual([])
  })

  it('длину режем: длинный список — не приоритеты, а свалка', () => {
    const many = Array.from({ length: 30 }, (_, i) => sig('deepen', `d${i}`, 0.5))
    expect(rankAgenda(many, 12)).toHaveLength(12)
  })
})

describe('сила сигнала покрытия', () => {
  it('пустая тема — полная острота, достигнутый порог — ноль', () => {
    expect(coverageStrength(0, 5)).toBe(1)
    expect(coverageStrength(5, 5)).toBe(0)
    expect(coverageStrength(9, 5)).toBe(0)
  })
})

describe('ключ и подпись', () => {
  it('ключ не зависит от регистра и пробелов — иначе «DevOps» и «devops» жили бы порознь', () => {
    expect(agendaKey('deepen', ' DevOps ')).toBe(agendaKey('deepen', 'devops'))
  })

  it('подпись строится кодом и содержит тему', () => {
    expect(agendaLabel('deepen', 'devops', true)).toContain('devops')
    expect(agendaLabel('demand', '', true)).not.toContain(':')
  })
})
