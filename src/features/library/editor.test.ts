import { describe, expect, it } from 'vitest'
import { emptyBlock, emptyItem, parseEditorItems, toEditorItems, toProposedItems, type EditorItem } from './editor'

const step = (over: Partial<EditorItem> = {}): EditorItem => ({ ...emptyItem(), ...over })

describe('editor block converters', () => {
  it('toProposedItems: step without title is dropped, non-step blocks are kept', () => {
    const items = [
      step({ title: 'Real step' }),
      step({ title: '   ' }), // мусор — отбрасываем
      { ...emptyBlock('text'), text: 'hello' },
      { ...emptyBlock('image'), imageKey: 'k/1', caption: 'cap' },
    ]
    const out = toProposedItems(items, 'en')
    expect(out).toHaveLength(3)
    expect(out[0].title).toEqual({ en: 'Real step' })
    expect(out[1]).toMatchObject({ type: 'text', content: { md: 'hello' } })
    expect(out[2]).toMatchObject({ type: 'image', hasImage: true, content: { ref: 'k/1', caption: 'cap' } })
  })

  it('toProposedItems: step emits no type/content (byte-compat with legacy)', () => {
    const [out] = toProposedItems([step({ title: 'x' })], 'en')
    expect(out.type).toBeUndefined()
    expect(out.content).toBeUndefined()
  })

  it('empty image caption is omitted from content (bid present)', () => {
    const [out] = toProposedItems([{ ...emptyBlock('image'), imageKey: 'k/2' }], 'en')
    expect(out.content).toMatchObject({ ref: 'k/2' })
    expect(out.content).not.toHaveProperty('caption')
    expect(typeof out.content?.bid).toBe('string') // стабильный id блока
  })

  it('non-step blocks carry a stable content.bid; step blocks do not', () => {
    const items = [step({ title: 'x' }), { ...emptyBlock('text'), text: 'hi' }]
    const out = toProposedItems(items, 'en')
    expect(out[0].content).toBeUndefined() // шаг — без content/bid
    expect(out[1].content?.bid).toBeTruthy()
  })

  it('bid survives editor → proposed → editor round-trip', () => {
    const block = { ...emptyBlock('text'), text: 'note' }
    const [proposed] = toProposedItems([block], 'en')
    const bid = proposed.content?.bid
    const [back] = toEditorItems([proposed], 'en')
    expect(back.bid).toBe(bid) // тот же id → merge увидит правку как modify
  })

  it('toEditorItems round-trips text/image blocks back to flat form', () => {
    const locale = [
      { type: 'text', content: { md: 'note' }, title: {}, desc: {}, command: '', hasImage: false, subtasks: [], refs: [] },
      { type: 'image', content: { ref: 'img/9', caption: 'shot' }, title: {}, desc: {}, command: '', hasImage: true, subtasks: [], refs: [] },
    ]
    const flat = toEditorItems(locale, 'en', { 'img/9': 'https://cdn/img9' })
    expect(flat[0]).toMatchObject({ type: 'text', text: 'note' })
    expect(flat[1]).toMatchObject({ type: 'image', imageKey: 'img/9', caption: 'shot', imagePreview: 'https://cdn/img9' })
  })

  it('parseEditorItems parses block type/text/caption and defaults bad type to step', () => {
    const raw = JSON.stringify([
      { type: 'text', text: 'md here' },
      { type: 'image', imageKey: 'k', caption: 'c' },
      { type: 'bogus', title: 'still a step' },
    ])
    const items = parseEditorItems(raw)
    expect(items[0]).toMatchObject({ type: 'text', text: 'md here' })
    expect(items[1]).toMatchObject({ type: 'image', imageKey: 'k', caption: 'c' })
    expect(items[2].type).toBe('step')
  })

  it('full round-trip: editor → proposed → editor keeps block kinds', () => {
    const original = [
      step({ title: 'Install', command: 'apt install x' }),
      { ...emptyBlock('text'), text: 'Some **markdown**' },
      { ...emptyBlock('image'), imageKey: 'scr/1', caption: 'a shot' },
    ]
    const proposed = toProposedItems(original, 'en')
    const back = toEditorItems(proposed, 'en')
    expect(back.map((b) => b.type)).toEqual(['step', 'text', 'image'])
    expect(back[1].text).toBe('Some **markdown**')
    expect(back[2].imageKey).toBe('scr/1')
    expect(back[2].caption).toBe('a shot')
  })
})
