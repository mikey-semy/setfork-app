import { describe, expect, it } from 'vitest'
import { repScore, REP_MIN_GENS, type GnomeRep } from '@/shared/ai/gnome-reputation'

describe('repScore (KPI-петля: репутация влияет на отбор экспертов)', () => {
  const rep: Record<string, GnomeRep> = {
    proven: { gens: 20, accepted: 16 }, // 0.8
    weak: { gens: 20, accepted: 4 }, // 0.2
    fresh: { gens: 2, accepted: 0 }, // мало данных
  }
  it('доля принятых при достаточных данных', () => {
    expect(repScore(rep, 'proven')).toBeCloseTo(0.8)
    expect(repScore(rep, 'weak')).toBeCloseTo(0.2)
  })
  it('мало генераций (< порога) → нейтральные 0.5, не наказываем', () => {
    expect(rep.fresh.gens).toBeLessThan(REP_MIN_GENS)
    expect(repScore(rep, 'fresh')).toBe(0.5)
  })
  it('нет записи → нейтральные 0.5', () => {
    expect(repScore(rep, 'unknown')).toBe(0.5)
  })
  it('сортировка кандидатов ставит уважаемого впереди слабого, а свежего — между', () => {
    const ids = ['weak', 'proven', 'fresh']
    const sorted = [...ids].sort((a, b) => repScore(rep, b) - repScore(rep, a))
    expect(sorted).toEqual(['proven', 'fresh', 'weak'])
  })
})
