import { describe, expect, it } from 'vitest'
import { applyChoices, threeWayMerge, type TwList, type TwStep } from './three-way'

const step = (title: string, over: Partial<TwStep> = {}): TwStep => ({
  title,
  desc: '',
  command: '',
  level: 'required',
  why: '',
  section: '',
  subtasks: [],
  refs: [],
  ...over,
})

const list = (steps: TwStep[], over: Partial<TwList> = {}): TwList => ({
  title: 'L',
  desc: '',
  tags: [],
  ordered: true,
  steps,
  ...over,
})

describe('threeWayMerge', () => {
  it('non-overlapping edits merge cleanly', () => {
    const base = list([step('a'), step('b'), step('c')])
    const ours = list([step('a', { desc: 'ours' }), step('b'), step('c')])
    const theirs = list([step('a'), step('b'), step('c', { desc: 'theirs' })])
    const r = threeWayMerge(base, ours, theirs)
    expect(r.conflicts).toHaveLength(0)
    expect(r.merged.steps.map((s) => s.desc)).toEqual(['ours', '', 'theirs'])
  })

  it('same edit on both sides is not a conflict', () => {
    const base = list([step('a')])
    const both = list([step('a', { command: 'x' })])
    const r = threeWayMerge(base, both, both)
    expect(r.conflicts).toHaveLength(0)
    expect(r.merged.steps[0].command).toBe('x')
  })

  it('modified/modified conflicts and resolves by choice', () => {
    const base = list([step('a')])
    const ours = list([step('a', { desc: 'O' })])
    const theirs = list([step('a', { desc: 'T' })])
    const r = threeWayMerge(base, ours, theirs)
    expect(r.conflicts).toEqual([expect.objectContaining({ key: 'a', kind: 'modified' })])
    expect(applyChoices(r, {}, {})).toBeNull() // без выбора не собирается
    expect(applyChoices(r, { a: 'theirs' }, {})!.steps[0].desc).toBe('T')
    expect(applyChoices(r, { a: 'ours' }, {})!.steps[0].desc).toBe('O')
  })

  it('delete vs modify conflicts both directions', () => {
    const base = list([step('a'), step('b')])
    const oursDel = list([step('b', { desc: 'kept' })]) // удалили a, поменяли b
    const theirsMod = list([step('a', { desc: 'T' }), step('b')])
    const r = threeWayMerge(base, oursDel, theirsMod)
    expect(r.conflicts).toEqual([expect.objectContaining({ key: 'a', kind: 'delete-ours' })])
    // выбор ours (= удалить): шаг пропадает; выбор theirs — остаётся с правкой
    expect(applyChoices(r, { a: 'ours' }, {})!.steps.map((s) => s.title)).toEqual(['b'])
    expect(applyChoices(r, { a: 'theirs' }, {})!.steps.map((s) => s.title)).toEqual(['b', 'a'])
  })

  it('deleted untouched step stays deleted; additions from both sides land', () => {
    const base = list([step('a'), step('b')])
    const ours = list([step('a'), step('o-new')]) // удалили b (не менялся), добавили o-new
    const theirs = list([step('a'), step('b'), step('t-new')])
    const r = threeWayMerge(base, ours, theirs)
    expect(r.conflicts).toHaveLength(0)
    const titles = r.merged.steps.map((s) => s.title)
    expect(titles).toContain('o-new')
    expect(titles).toContain('t-new')
    expect(titles).not.toContain('b')
  })

  it('theirs addition keeps its anchor position', () => {
    const base = list([step('a'), step('c')])
    const ours = list([step('a'), step('c')])
    const theirs = list([step('a'), step('b'), step('c')])
    const r = threeWayMerge(base, ours, theirs)
    expect(r.merged.steps.map((s) => s.title)).toEqual(['a', 'b', 'c'])
  })

  it('meta conflict on title requires a choice', () => {
    const base = list([], { title: 'Base' })
    const ours = list([], { title: 'Ours' })
    const theirs = list([], { title: 'Theirs' })
    const r = threeWayMerge(base, ours, theirs)
    expect(r.metaConflicts).toEqual([expect.objectContaining({ field: 'title' })])
    expect(applyChoices(r, {}, { title: 'theirs' })!.title).toBe('Theirs')
  })

  it('one-sided meta change flows through without conflict', () => {
    const base = list([], { tags: ['x'] })
    const ours = list([], { tags: ['x'] })
    const theirs = list([], { tags: ['x', 'y'] })
    const r = threeWayMerge(base, ours, theirs)
    expect(r.metaConflicts).toHaveLength(0)
    expect(r.merged.tags).toEqual(['x', 'y'])
  })
})
