import { describe, it, expect } from 'vitest'
import { blockLabel, diffSteps, serializeSteps, lineDiff, type CmpStep } from '@/features/library/diff'

/** Презентационный блок: title пустой, всё содержимое — в content. */
const textBlock = (md: string): CmpStep => ({
  type: 'text',
  content: { md },
  title: '',
  desc: '',
  command: '',
  level: 'required',
  why: '',
  subtasks: [],
})

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

describe('diffSteps entries', () => {
  it('помечает статусы и заполняет changes/before у changed', () => {
    const from = [step('keep'), step('mod', { command: 'old' }), step('gone')]
    const to = [step('keep'), step('mod', { command: 'new' }), step('fresh')]
    const { entries } = diffSteps(from, to)
    const byTitle = Object.fromEntries(entries.map((e) => [e.title, e]))
    expect(byTitle['keep'].status).toBe('unchanged')
    expect(byTitle['mod'].status).toBe('changed')
    expect(byTitle['mod'].changes).toContain('command')
    expect(byTitle['mod'].before?.command).toBe('old')
    expect(byTitle['fresh'].status).toBe('added')
    expect(byTitle['gone'].status).toBe('removed')
  })

  it('ловит каждый тип изменения поля', () => {
    const base = step('s', { desc: 'd', command: 'c', why: 'w', level: 'required', subtasks: ['x'], refs: [{ label: 'L', url: 'https://a' }] })
    const cases: [Partial<CmpStep>, string][] = [
      [{ desc: 'd2' }, 'desc'],
      [{ command: 'c2' }, 'command'],
      [{ level: 'optional' }, 'level'],
      [{ why: 'w2' }, 'why'],
      [{ subtasks: ['x', 'y'] }, 'subtasks'],
      [{ refs: [{ label: 'L', url: 'https://b' }] }, 'refs'],
    ]
    for (const [over, field] of cases) {
      const { entries } = diffSteps([base], [{ ...base, ...over }])
      expect(entries[0].changes, field).toEqual([field])
      expect(entries[0].status).toBe('changed')
    }
  })

  it('ключ пункта регистронезависим (title "A" == "a")', () => {
    const { summary } = diffSteps([step('Deploy')], [step('deploy')])
    expect(summary).toMatchObject({ added: 0, removed: 0, changed: 0 })
  })
})

describe('serializeSteps', () => {
  it('нумерует ordered и маркирует unordered', () => {
    const s = [step('first'), step('second')]
    expect(serializeSteps(s, true).find((l) => l.head)?.text).toBe('1. first')
    expect(serializeSteps(s, false).find((l) => l.head)?.text).toBe('• first')
  })

  it('бейдж уровня только для не-required', () => {
    const [line] = serializeSteps([step('t', { level: 'optional' })], true)
    expect(line.text).toContain('[optional]')
    expect(serializeSteps([step('t')], true)[0].text).not.toContain('[')
  })

  it('заголовок секции — при смене, не при повторе', () => {
    const s = [step('a', { section: 'Setup' }), step('b', { section: 'Setup' }), step('c', { section: 'Deploy' })]
    const headers = serializeSteps(s, true).filter((l) => l.text.startsWith('## '))
    expect(headers.map((h) => h.text)).toEqual(['## Setup', '## Deploy'])
  })

  it('desc/command/why/subtasks/refs раскрываются в строки с привязкой к пункту', () => {
    const s = [step('t', { desc: 'line1\nline2', command: 'npm i', why: 'because', subtasks: ['ck'], refs: [{ label: 'Doc', url: 'https://d' }] })]
    const lines = serializeSteps(s, true)
    const texts = lines.map((l) => l.text)
    expect(texts).toContain('    line1')
    expect(texts).toContain('    line2')
    expect(texts).toContain('    $ npm i')
    expect(texts).toContain('    why: because')
    expect(texts).toContain('    - [ ] ck')
    expect(texts).toContain('    → Doc — https://d')
    expect(lines.every((l) => l.step === 1)).toBe(true) // все строки принадлежат пункту 1
    expect(lines.filter((l) => l.head)).toHaveLength(1) // ровно один заголовок
  })

  it('ref: только label / только url / пустой', () => {
    const only = (refs: CmpStep['refs']) => serializeSteps([step('t', { refs })], true).map((l) => l.text)
    expect(only([{ label: 'Name', url: '' }])).toContain('    → Name')
    expect(only([{ label: '', url: 'https://u' }])).toContain('    → https://u')
    expect(only([{ label: '', url: '' }]).some((t) => t.startsWith('    →'))).toBe(false)
  })
})

describe('lineDiff', () => {
  const S = (title: string) => serializeSteps([step(title)], true)

  it('идентичные → всё ctx, 0 add/del', () => {
    const r = lineDiff(S('same'), S('same'))
    expect(r.added).toBe(0)
    expect(r.removed).toBe(0)
    expect(r.rows.every((x) => x.type === 'ctx')).toBe(true)
  })

  it('вставка → add-строки с newNo', () => {
    const r = lineDiff([], S('brand new'))
    expect(r.added).toBeGreaterThan(0)
    expect(r.removed).toBe(0)
    expect(r.rows.every((x) => x.type === 'add')).toBe(true)
  })

  it('удаление → del-строки', () => {
    const r = lineDiff(S('going away'), [])
    expect(r.removed).toBeGreaterThan(0)
    expect(r.added).toBe(0)
    expect(r.rows.every((x) => x.type === 'del')).toBe(true)
  })

  it('изменённая строка → пара del/add с пословной подсветкой (segs)', () => {
    const a = serializeSteps([step('deploy the app')], true)
    const b = serializeSteps([step('deploy the service')], true)
    const r = lineDiff(a, b)
    const del = r.rows.find((x) => x.type === 'del' && x.head)
    const add = r.rows.find((x) => x.type === 'add' && x.head)
    expect(del?.segs, 'del segs').toBeDefined()
    expect(add?.segs, 'add segs').toBeDefined()
    // общий префикс не помечен изменённым, различающееся слово — помечено
    expect(del!.segs!.some((s) => s.changed && /app/.test(s.text))).toBe(true)
    expect(add!.segs!.some((s) => s.changed && /service/.test(s.text))).toBe(true)
    expect(del!.segs!.some((s) => !s.changed)).toBe(true) // "deploy the " общее
  })
})

// Регрессия: блок «Текст» в диффе показывался голым «1.» — его содержимое не
// сериализовалось вовсе, и удалённый сверху текст было НЕ ПОСМОТРЕТЬ.
describe('презентационные блоки в диффе', () => {
  it('текст блока попадает в строки — удалённый блок видно целиком', () => {
    const lines = serializeSteps([textBlock('Первая строка\nВторая строка')], true)
    const all = lines.map((l) => l.text).join('\n')
    expect(all).toContain('Первая строка')
    expect(all).toContain('Вторая строка')
    expect(lines.some((l) => /^\d+\.\s*$/.test(l.text))).toBe(false) // не «1.» без текста
  })

  it('удаление блока даёт строки удаления с его текстом', () => {
    const r = lineDiff(serializeSteps([textBlock('много текста тут')], true), [])
    expect(r.rows.every((x) => x.type === 'del')).toBe(true)
    expect(r.rows.map((x) => x.text).join('\n')).toContain('много текста тут')
  })

  it('нумерация шагов не сбивается о презентационные блоки', () => {
    const lines = serializeSteps([textBlock('интро'), step('первый шаг'), step('второй шаг')], true)
    const heads = lines.filter((l) => l.head).map((l) => l.text)
    expect(heads.some((h) => h.startsWith('1. первый шаг'))).toBe(true)
    expect(heads.some((h) => h.startsWith('2. второй шаг'))).toBe(true)
  })

  it('blockLabel даёт подпись блоку и заголовок шагу', () => {
    expect(blockLabel(textBlock('Заголовок текста\nостальное'))).toBe('Заголовок текста')
    expect(blockLabel(step('обычный шаг'))).toBe('обычный шаг')
  })

  it('шаг и блок с одинаковой подписью не матчатся друг с другом', () => {
    const { summary } = diffSteps([step('одно и то же')], [textBlock('одно и то же')])
    expect(summary.added).toBe(1)
    expect(summary.removed).toBe(1)
    expect(summary.changed).toBe(0)
  })
})

// Стабильный blockId: идентичность живёт сквозь версии (модель Notion).
describe('дифф по стабильному blockId', () => {
  const id = (bid: string, title: string, over: Partial<CmpStep> = {}) => step(title, { blockId: bid, ...over })

  it('переименование — это «изменён», а не «удалён + добавлен»', () => {
    const { summary, entries } = diffSteps([id('b1', 'Замочить желатин')], [id('b1', 'Замочить желатин в воде')])
    expect(summary).toMatchObject({ added: 0, removed: 0, changed: 1 })
    expect(entries[0].changes).toContain('title')
    expect(entries[0].before?.title).toBe('Замочить желатин')
  })

  it('без идентичности то же переименование по-прежнему удалён+добавлен (фолбэк)', () => {
    const { summary } = diffSteps([step('Замочить желатин')], [step('Замочить желатин в воде')])
    expect(summary).toMatchObject({ added: 1, removed: 1, changed: 0 })
  })

  it('два пункта с ОДИНАКОВЫМ заголовком не склеиваются в один', () => {
    const { summary } = diffSteps([id('b1', 'Помешать'), id('b2', 'Помешать')], [id('b1', 'Помешать'), id('b2', 'Помешать')])
    expect(summary).toEqual({ added: 0, removed: 0, changed: 0, moved: 0 })
  })

  it('удаление одного из двух одинаковых заголовков считается один раз', () => {
    const { summary } = diffSteps([id('b1', 'Помешать'), id('b2', 'Помешать')], [id('b1', 'Помешать')])
    expect(summary).toMatchObject({ added: 0, removed: 1, changed: 0 })
  })

  it('перестановка по идентичности — moved, содержимое не трогали', () => {
    const from = [id('b1', 'Первый'), id('b2', 'Второй')]
    const to = [id('b2', 'Второй'), id('b1', 'Первый')]
    const { summary } = diffSteps(from, to)
    expect(summary).toMatchObject({ added: 0, removed: 0, changed: 0 })
    expect(summary.moved).toBeGreaterThan(0)
  })

  it('новый blockId = новый пункт, даже если заголовок совпал со старым', () => {
    const { summary } = diffSteps([id('b1', 'Помешать')], [id('b2', 'Помешать')])
    expect(summary).toMatchObject({ added: 1, removed: 1, changed: 0 })
  })
})
