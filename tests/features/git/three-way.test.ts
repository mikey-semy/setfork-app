import { describe, expect, it } from 'vitest'
import { applyChoices, threeWayMerge, type TwList, type TwStep } from '@/features/git/three-way'

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

// Блочная модель: text/image блоки не должны ломать/терять merge.
const textBlk = (md: string): TwStep => ({ ...step(''), type: 'text', content: { md } })
const imgBlk = (ref: string, caption = ''): TwStep => ({ ...step(''), type: 'image', content: { ref, caption } })

describe('threeWayMerge — блоки', () => {
  it('несколько text-блоков не коллапсируют в один ключ', () => {
    const base = list([step('a'), textBlk('one'), textBlk('two')])
    const ours = list([step('a'), textBlk('one'), textBlk('two')])
    const theirs = list([step('a'), textBlk('one'), textBlk('two')])
    const r = threeWayMerge(base, ours, theirs)
    expect(r.conflicts).toHaveLength(0)
    // оба text-блока сохранены (не схлопнулись по пустому title)
    expect(r.merged.steps.filter((s) => s.type === 'text')).toHaveLength(2)
  })

  it('добавленный в theirs image-блок попадает в merged после якоря', () => {
    const base = list([step('a'), step('b')])
    const ours = list([step('a'), step('b')])
    const theirs = list([step('a'), imgBlk('img/1', 'shot'), step('b')])
    const r = threeWayMerge(base, ours, theirs)
    expect(r.conflicts).toHaveLength(0)
    const kinds = r.merged.steps.map((s) => s.type ?? 'step')
    expect(kinds).toEqual(['step', 'image', 'step'])
  })

  it('step-блоки по-прежнему ключуются по title (byte-compat)', () => {
    const base = list([step('a'), textBlk('note'), step('b')])
    const ours = list([step('a', { desc: 'ours' }), textBlk('note'), step('b')])
    const theirs = list([step('a'), textBlk('note'), step('b', { desc: 'theirs' })])
    const r = threeWayMerge(base, ours, theirs)
    expect(r.conflicts).toHaveLength(0)
    expect(r.merged.steps.find((s) => s.title === 'a')?.desc).toBe('ours')
    expect(r.merged.steps.find((s) => s.title === 'b')?.desc).toBe('theirs')
    expect(r.merged.steps.some((s) => s.type === 'text' && s.content?.md === 'note')).toBe(true)
  })

  it('удалённый в theirs text-блок исчезает без конфликта', () => {
    const base = list([step('a'), textBlk('gone'), step('b')])
    const ours = list([step('a'), textBlk('gone'), step('b')])
    const theirs = list([step('a'), step('b')])
    const r = threeWayMerge(base, ours, theirs)
    expect(r.conflicts).toHaveLength(0)
    expect(r.merged.steps.some((s) => s.type === 'text')).toBe(false)
  })

  // Стабильный content.bid: правка text-блока — modify, а не add+remove.
  const textWithBid = (md: string, bid: string): TwStep => ({ ...step(''), type: 'text', content: { md, bid } })

  it('правка text-блока с тем же bid только в одной стороне → берём правку (не дубль)', () => {
    const base = list([step('a'), textWithBid('v1', 'B1')])
    const ours = list([step('a'), textWithBid('v1', 'B1')])
    const theirs = list([step('a'), textWithBid('v2 edited', 'B1')])
    const r = threeWayMerge(base, ours, theirs)
    expect(r.conflicts).toHaveLength(0)
    const texts = r.merged.steps.filter((s) => s.type === 'text')
    expect(texts).toHaveLength(1) // один блок, не add+remove
    expect(texts[0].content?.md).toBe('v2 edited')
  })

  it('разная правка одного bid в обеих сторонах → КОНФЛИКТ modify/modify', () => {
    const base = list([textWithBid('v1', 'B1')])
    const ours = list([textWithBid('ours edit', 'B1')])
    const theirs = list([textWithBid('theirs edit', 'B1')])
    const r = threeWayMerge(base, ours, theirs)
    expect(r.conflicts).toHaveLength(1)
    expect(r.conflicts[0].kind).toBe('modified')
  })
})
