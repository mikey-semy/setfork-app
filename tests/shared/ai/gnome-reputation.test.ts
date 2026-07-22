import { describe, expect, it } from 'vitest'
import { gnomeMood, repScore, REP_MIN_GENS, type GnomeRep } from '@/shared/ai/gnome-reputation'

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

describe('gnomeMood (RPG-развитие: настроение из послужного списка → стиль)', () => {
  const R = (gens: number, accepted: number): Record<string, GnomeRep> => ({ g: { gens, accepted } })
  it('часто принимают → окрылённый, тёплый стиль', () => {
    const m = gnomeMood(R(20, 15), 'g') // 0.75
    expect(m.labelRu).toBe('окрылённый')
    expect(m.style).toContain('upbeat')
  })
  it('часто отклоняют → ворчливый и обидчивый', () => {
    const m = gnomeMood(R(20, 2), 'g') // 0.1
    expect(m.labelRu).toBe('ворчливый')
    expect(m.style).toMatch(/grumbl|touchy/)
  })
  it('мало данных → ровный, без навязанного настроения (пустой стиль)', () => {
    const m = gnomeMood(R(2, 0), 'g')
    expect(m.labelRu).toBe('ровный')
    expect(m.style).toBe('')
  })
  it('бывалый с высокой принятостью — «тихо гордится»', () => {
    const m = gnomeMood(R(REP_MIN_GENS * 3, REP_MIN_GENS * 3), 'g')
    expect(m.style).toContain('proud')
  })
  it('нет записи → ровный', () => {
    expect(gnomeMood({}, 'unknown').labelRu).toBe('ровный')
  })
})
