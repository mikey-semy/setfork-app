import { describe, expect, it } from 'vitest'
import { gnomeMood, repScore, REP_MIN_GENS, type GnomeRep, type RepBasics } from '@/shared/ai/gnome-reputation'

describe('repScore (KPI-петля: репутация влияет на отбор экспертов)', () => {
  // acceptedShare — кредит С СОХРАНЕНИЕМ (Σ 1/N). Здесь гном был единственным
  // набросчиком, поэтому доля равна числу принятий и балл тот же, что и раньше.
  const rep: Record<string, GnomeRep> = {
    proven: { gens: 20, accepted: 16, acceptedShare: 16 }, // 0.8
    weak: { gens: 20, accepted: 4, acceptedShare: 4 }, // 0.2
    fresh: { gens: 2, accepted: 0, acceptedShare: 0 }, // мало данных
  }
  it('доля принятых при достаточных данных', () => {
    expect(repScore(rep, 'proven')).toBeCloseTo(0.8)
    expect(repScore(rep, 'weak')).toBeCloseTo(0.2)
  })

  it('кредит РАЗДЕЛЁН между набросчиками — балл не растёт от ширины совета', () => {
    // Один и тот же результат работы: 20 генераций, все приняты. Но в первом случае гном
    // был единственным набросчиком, во втором — одним из четырёх. Раньше оба давали 1.0,
    // то есть балл измерял размер совета, а не качество вклада.
    const solo: Record<string, GnomeRep> = { g: { gens: 20, accepted: 20, acceptedShare: 20 } }
    const oneOfFour: Record<string, GnomeRep> = { g: { gens: 20, accepted: 20, acceptedShare: 5 } }
    expect(repScore(solo, 'g')).toBeCloseTo(1)
    expect(repScore(oneOfFour, 'g')).toBeCloseTo(0.25)
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
  const R = (gens: number, accepted: number): Record<string, RepBasics> => ({ g: { gens, accepted } })
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

describe('gnomeMood + «спасибо» (одушевление: поблагодарят → добрее)', () => {
  const R = (gens: number, accepted: number): Record<string, RepBasics> => ({ g: { gens, accepted } })
  it('пара «спасибо» без статистики → тронут (тёплый), не ровный', () => {
    const m = gnomeMood({}, 'g', 3)
    expect(m.labelRu).toBe('тронут')
    expect(m.style).toContain('thanked')
  })
  it('«спасибо» согревает даже ворчуна (в стиле появляется тёплая нота)', () => {
    const m = gnomeMood(R(20, 2), 'g', 4) // низкая принятость, но благодарили
    expect(m.style).toContain('thanked')
  })
  it('одно «спасибо» (< порога) не меняет ровного', () => {
    expect(gnomeMood({}, 'g', 1).labelRu).toBe('ровный')
  })
})
