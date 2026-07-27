import { describe, expect, it } from 'vitest'
import { diffSteps } from '@/features/library/suggestion-diff'

// Шаг в форме, которую принимает diffSteps (LocaleText в jsonb-полях).
const s = (title: string, over: Record<string, unknown> = {}) => ({
  title: { en: title },
  desc: {},
  command: '',
  level: 'required',
  why: {},
  section: {},
  subtasks: [],
  refs: [],
  ...over,
})

describe('diffSteps — step-level diff', () => {
  it('classifies add / remove / modify / unchanged with correct summary', () => {
    const base = [s('Install'), s('Configure', { desc: { en: 'old' } }), s('Old step')]
    const proposed = [s('Install'), s('Configure', { desc: { en: 'new' }, level: 'recommended' }), s('New step')]
    const { rows, summary } = diffSteps(base, proposed, 'en')
    expect(summary).toEqual({ added: 1, removed: 1, modified: 1, unchanged: 1 })
    expect(rows.map((r) => r.kind)).toEqual(['same', 'mod', 'del', 'add'])
  })

  it('reports per-field changes on a modified step', () => {
    const base = [s('Configure', { desc: { en: 'old' }, level: 'required' })]
    const proposed = [s('Configure', { desc: { en: 'new' }, level: 'recommended' })]
    const row = diffSteps(base, proposed, 'en').rows[0]
    expect(row.kind).toBe('mod')
    if (row.kind === 'mod') {
      const fields = row.changes.map((c) => c.field)
      expect(fields).toContain('desc')
      expect(fields).toContain('level')
      const desc = row.changes.find((c) => c.field === 'desc')!
      expect([desc.before, desc.after]).toEqual(['old', 'new'])
    }
  })

  it('empty base → every proposed step is an addition', () => {
    const { rows, summary } = diffSteps([], [s('A'), s('B')], 'en')
    expect(summary).toMatchObject({ added: 2, removed: 0, modified: 0, unchanged: 0 })
    expect(rows.every((r) => r.kind === 'add')).toBe(true)
  })

  it('identical lists → all unchanged, no false modifications', () => {
    const list = [s('A', { desc: { en: 'x' } }), s('B')]
    const { rows, summary } = diffSteps(list, list, 'en')
    expect(summary).toMatchObject({ added: 0, removed: 0, modified: 0, unchanged: 2 })
    expect(rows.every((r) => r.kind === 'same')).toBe(true)
  })

  it('removing all steps → every base step is a deletion', () => {
    const { summary } = diffSteps([s('A'), s('B')], [], 'en')
    expect(summary).toMatchObject({ added: 0, removed: 2, modified: 0, unchanged: 0 })
  })

  // Стабильный blockId: правка, переименовавшая пункт, должна читаться как
  // ИЗМЕНЕНИЕ одной строки, а не как «удалили + добавили» двумя.
  describe('дифф по стабильному blockId', () => {
    const id = (bid: string, title: string, over: Record<string, unknown> = {}) => s(title, { blockId: bid, ...over })

    it('переименование пункта → modified, а не removed+added', () => {
      const { rows, summary } = diffSteps([id('b1', 'Замочить желатин')], [id('b1', 'Замочить желатин в воде')], 'en')
      expect(summary).toMatchObject({ added: 0, removed: 0, modified: 1 })
      const mod = rows.find((r) => r.kind === 'mod')
      expect(mod).toBeDefined()
      if (mod?.kind === 'mod') expect(mod.changes.some((c) => c.field === 'title')).toBe(true)
    })

    it('без идентичности то же переименование остаётся removed+added (фолбэк)', () => {
      const { summary } = diffSteps([s('Замочить желатин')], [s('Замочить желатин в воде')], 'en')
      expect(summary).toMatchObject({ added: 1, removed: 1, modified: 0 })
    })

    it('новый blockId при совпавшем заголовке — это другой пункт', () => {
      const { summary } = diffSteps([id('b1', 'Помешать')], [id('b2', 'Помешать')], 'en')
      expect(summary).toMatchObject({ added: 1, removed: 1, modified: 0 })
    })

    it('одинаковые заголовки с разными id не склеиваются', () => {
      const list = [id('b1', 'Помешать'), id('b2', 'Помешать')]
      const { summary } = diffSteps(list, list, 'en')
      expect(summary).toMatchObject({ added: 0, removed: 0, modified: 0, unchanged: 2 })
    })
  })
})
