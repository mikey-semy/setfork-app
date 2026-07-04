import { describe, it, expect } from 'vitest'
import { diffSteps, type CmpStep } from './diff'

const step = (title: string, over: Partial<CmpStep> = {}): CmpStep => ({
  title,
  desc: '',
  command: '',
  level: 'required',
  why: '',
  subtasks: [],
  ...over,
})

describe('diffSteps summary', () => {
  it('counts a pure reorder as moved (not "nothing changed")', () => {
    const from = [step('a'), step('b'), step('c')]
    const to = [step('c'), step('a'), step('b')]
    const { summary } = diffSteps(from, to)
    expect(summary).toMatchObject({ added: 0, removed: 0, changed: 0 })
    expect(summary.moved).toBeGreaterThan(0)
  })

  it('identical lists → all zeros', () => {
    const same = [step('a'), step('b')]
    expect(diffSteps(same, same).summary).toEqual({ added: 0, removed: 0, changed: 0, moved: 0 })
  })

  it('add / remove / change are counted', () => {
    const from = [step('a'), step('b')]
    const to = [step('a', { desc: 'now with desc' }), step('c')]
    const { summary } = diffSteps(from, to)
    expect(summary.added).toBe(1) // c
    expect(summary.removed).toBe(1) // b
    expect(summary.changed).toBe(1) // a
  })
})
