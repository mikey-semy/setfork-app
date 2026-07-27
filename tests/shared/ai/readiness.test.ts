import { describe, expect, it } from 'vitest'
import { DEFAULT_BAR, readinessDecision, structuralBlockers, type ReadinessBar, type ReadinessFacts, type LensVerdict } from '@/shared/ai/readiness'

// Гейт готовности: единственное место, где складываются вердикты линз — и складывает их
// КОД. Тесты держат три свойства, каждое против конкретного способа обмануться:
// fail-closed (нет ответа ≠ годно), 'unsure' = не пропуск, и режим решает публикацию.

const goodFacts: ReadinessFacts = { steps: 8, deadLinks: 0, hasDesc: true, hasTags: true, duplicateSteps: 0 }
const allPass: LensVerdict[] = [
  { lens: 'actionable', answer: 'pass', reason: '' },
  { lens: 'grounded', answer: 'pass', reason: '' },
  { lens: 'improvable', answer: 'pass', reason: '' },
]
const barOn: ReadinessBar = { ...DEFAULT_BAR, mode: 'on' }

describe('структурные блокеры (кодом, без модели)', () => {
  it('короткий список, мёртвые ссылки, дубли, отсутствие описания/тегов', () => {
    const facts: ReadinessFacts = { steps: 2, deadLinks: 1, hasDesc: false, hasTags: false, duplicateSteps: 3 }
    expect(structuralBlockers(facts, DEFAULT_BAR)).toHaveLength(5)
  })

  it('годная структура блокеров не даёт', () => {
    expect(structuralBlockers(goodFacts, DEFAULT_BAR)).toEqual([])
  })

  it('мёртвые ссылки можно разрешить планкой явно', () => {
    const facts = { ...goodFacts, deadLinks: 2 }
    expect(structuralBlockers(facts, DEFAULT_BAR)).toHaveLength(1)
    expect(structuralBlockers(facts, { ...DEFAULT_BAR, allowDeadLinks: true })).toEqual([])
  })
})

describe('кворум линз', () => {
  it('все линзы pass + режим on → публикуем', () => {
    const d = readinessDecision(goodFacts, allPass, barOn)
    expect(d).toMatchObject({ publish: true, wouldPass: true, blockers: [] })
  })

  it('одна линза fail → не публикуем, причина видна', () => {
    const verdicts = allPass.map((v) => (v.lens === 'grounded' ? { ...v, answer: 'fail' as const, reason: 'выдуманный ГОСТ' } : v))
    const d = readinessDecision(goodFacts, verdicts, barOn)
    expect(d.publish).toBe(false)
    expect(d.blockers[0]).toContain('grounded')
    expect(d.blockers[0]).toContain('выдуманный ГОСТ')
  })

  it("'unsure' считается НЕ пропуском: сомнение линзы — повод оставить человеку", () => {
    const verdicts = allPass.map((v) => (v.lens === 'improvable' ? { ...v, answer: 'unsure' as const } : v))
    expect(readinessDecision(goodFacts, verdicts, barOn).publish).toBe(false)
  })

  it('fail-closed: линза не ответила (модель упала) — это блокер, а не «пропустим»', () => {
    const verdicts = allPass.filter((v) => v.lens !== 'actionable')
    const d = readinessDecision(goodFacts, verdicts, barOn)
    expect(d.publish).toBe(false)
    expect(d.blockers).toContain('линза actionable: ответа нет')
  })

  it('вообще ни одного ответа → блокеры по всем обязательным линзам', () => {
    expect(readinessDecision(goodFacts, [], barOn).blockers).toHaveLength(3)
  })

  it('планка без обязательных линз пропустить не может', () => {
    const d = readinessDecision(goodFacts, allPass, { ...barOn, required: [] })
    expect(d.publish).toBe(false)
    expect(d.blockers).toContain('планка не настроена: нет обязательных линз')
  })

  it('планка может требовать не все линзы', () => {
    const verdicts: LensVerdict[] = [{ lens: 'actionable', answer: 'pass', reason: '' }]
    expect(readinessDecision(goodFacts, verdicts, { ...barOn, required: ['actionable'] }).publish).toBe(true)
  })
})

describe('класс полноты как планка', () => {
  const withGrade = (grade: 'stub' | 'start' | 'solid' | 'full', next: string[] = []) => ({ ...goodFacts, grade, gradeNext: next })

  it('класс ниже планки — блокер с объяснением, чего не хватает', () => {
    const d = readinessDecision(withGrade('start', ['источников меньше двух']), allPass, barOn)
    expect(d.publish).toBe(false)
    expect(d.blockers[0]).toContain('класс «start» ниже планки «solid»')
    expect(d.blockers[0]).toContain('источников меньше двух')
  })

  it('класс на уровне планки или выше — не мешает', () => {
    expect(readinessDecision(withGrade('solid'), allPass, barOn).publish).toBe(true)
    expect(readinessDecision(withGrade('full'), allPass, barOn).publish).toBe(true)
  })

  it('планку можно поднять до full — тогда solid уже мало', () => {
    const d = readinessDecision(withGrade('solid'), allPass, { ...barOn, minGrade: 'full' })
    expect(d.publish).toBe(false)
  })

  it('класс не посчитан — по классу не судим (старые вызовы не ломаются)', () => {
    expect(readinessDecision(goodFacts, allPass, barOn).publish).toBe(true)
  })
})

describe('режимы', () => {
  it("'shadow' считает решение, но НЕ публикует", () => {
    const d = readinessDecision(goodFacts, allPass, { ...DEFAULT_BAR, mode: 'shadow' })
    expect(d).toMatchObject({ publish: false, wouldPass: true })
  })

  it("'off' — дефолт: автопубликация не включается сама", () => {
    expect(DEFAULT_BAR.mode).toBe('off')
    expect(readinessDecision(goodFacts, allPass, DEFAULT_BAR).publish).toBe(false)
  })

  it('лишние вердикты сверх планки решение не меняют', () => {
    const extra: LensVerdict[] = [...allPass, { lens: 'grounded', answer: 'fail', reason: 'дубль-ответ' }]
    // Map по линзе: последний ответ выигрывает — важно, чтобы это было ДЕТЕРМИНИРОВАНО.
    expect(readinessDecision(goodFacts, extra, barOn).publish).toBe(false)
  })
})
