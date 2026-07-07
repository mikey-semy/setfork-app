import { describe, expect, it } from 'vitest'
import { emptyBlock, emptyItem, parseEditorItems, toEditorItems, toProposedItems, type EditorItem } from './editor'
import { parseVideoEmbed } from './blocks'

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

  it('poll block: options/multi/deadline ride in content; empty options dropped', () => {
    const poll = { ...emptyBlock('poll') }
    poll.poll = { question: 'Best DB?', options: [{ id: 'o1', text: 'Postgres' }, { id: 'o2', text: '' }, { id: 'o3', text: 'SQLite' }], multi: true, deadline: '2026-08-01T10:00' }
    const [out] = toProposedItems([poll], 'en')
    expect(out.type).toBe('poll')
    expect(out.content).toMatchObject({ question: 'Best DB?', multi: true, deadline: '2026-08-01T10:00' })
    // пустой вариант отброшен, id сохранены
    expect(out.content?.options).toEqual([{ id: 'o1', text: 'Postgres' }, { id: 'o3', text: 'SQLite' }])
    expect(typeof out.content?.bid).toBe('string')
  })

  it('poll round-trips editor → proposed → editor (ids/multi preserved)', () => {
    const poll = { ...emptyBlock('poll'), poll: { question: 'Q', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], multi: false, deadline: '' } }
    const [proposed] = toProposedItems([poll], 'en')
    const [back] = toEditorItems([proposed], 'en')
    expect(back.type).toBe('poll')
    expect(back.poll.question).toBe('Q')
    expect(back.poll.options).toEqual([{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }])
  })

  it('video block: url/caption ride in content; round-trips', () => {
    const v = { ...emptyBlock('video'), videoUrl: 'https://youtu.be/dQw4w9WgXcQ', caption: 'demo' }
    const [out] = toProposedItems([v], 'en')
    expect(out.type).toBe('video')
    expect(out.content).toMatchObject({ url: 'https://youtu.be/dQw4w9WgXcQ', caption: 'demo' })
    const [back] = toEditorItems([out], 'en')
    expect(back.type).toBe('video')
    expect(back.videoUrl).toBe('https://youtu.be/dQw4w9WgXcQ')
    expect(back.caption).toBe('demo')
  })

  it('quiz block: correct flags/multi/explain ride in content; empty options dropped', () => {
    const quiz = { ...emptyBlock('quiz') }
    quiz.quiz = {
      question: '2+2?',
      options: [{ id: 'a', text: '3', correct: false }, { id: 'b', text: '', correct: false }, { id: 'c', text: '4', correct: true }],
      multi: false,
      explain: 'basic arithmetic',
    }
    const [out] = toProposedItems([quiz], 'en')
    expect(out.type).toBe('quiz')
    expect(out.content).toMatchObject({ question: '2+2?', explain: 'basic arithmetic' })
    // пустой вариант отброшен; correct:false НЕ сериализуется, correct:true — да
    expect(out.content?.options).toEqual([{ id: 'a', text: '3' }, { id: 'c', text: '4', correct: true }])
    // multi:false опущен
    expect((out.content as { multi?: boolean }).multi).toBeUndefined()
  })

  it('quiz round-trips editor → proposed → editor (correct flags preserved)', () => {
    const quiz = {
      ...emptyBlock('quiz'),
      quiz: { question: 'Q', options: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B', correct: false }], multi: true, explain: '' },
    }
    const [proposed] = toProposedItems([quiz], 'en')
    const [back] = toEditorItems([proposed], 'en')
    expect(back.type).toBe('quiz')
    expect(back.quiz.multi).toBe(true)
    expect(back.quiz.options).toEqual([{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B', correct: false }])
  })

  it('section (урок) carries through non-step blocks and round-trips', () => {
    const vid = { ...emptyBlock('video'), videoUrl: 'https://youtu.be/dQw4w9WgXcQ', section: 'Урок 1' }
    const [out] = toProposedItems([vid], 'en')
    expect(out.type).toBe('video')
    expect(out.section).toEqual({ en: 'Урок 1' })
    const [back] = toEditorItems([out], 'en')
    expect(back.type).toBe('video')
    expect(back.section).toBe('Урок 1')
  })

  it('parseVideoEmbed: YouTube/Vimeo → iframe src, .mp4 → file, прочее → link', () => {
    expect(parseVideoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ kind: 'youtube', src: 'https://www.youtube.com/embed/dQw4w9WgXcQ' })
    expect(parseVideoEmbed('https://youtu.be/dQw4w9WgXcQ')).toEqual({ kind: 'youtube', src: 'https://www.youtube.com/embed/dQw4w9WgXcQ' })
    expect(parseVideoEmbed('https://vimeo.com/123456789')).toEqual({ kind: 'vimeo', src: 'https://player.vimeo.com/video/123456789' })
    expect(parseVideoEmbed('https://cdn.example.com/clip.mp4').kind).toBe('file')
    expect(parseVideoEmbed('https://example.com/watch').kind).toBe('link') // произвольный src НЕ идёт в iframe
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
