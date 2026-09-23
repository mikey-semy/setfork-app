import { describe, expect, it } from 'vitest'
import { toHtml, toMarkdown, type ExportList, type ExportStep } from '@/features/library/export'
import { lineDiff, serializeSteps, type CmpStep } from '@/features/library/diff'

// Ссылки-источники в ЭКСПОРТЕ (#962, находка Codex на #963).
//
// Экспорт — то, что человек уносит из сервиса: markdown и отдельная HTML-страница.
// Текстовый блок уходил туда одними словами, а блок только со ссылками пропадал
// целиком. Заодно: ссылка одним адресом терялась и у ШАГА — экспорт пропускал её по
// пустой подписи, хотя интерфейс показывает такую ссылку доменом.

const text = (md: string, refs: ExportStep['refs']): ExportStep => ({
  n: 1,
  type: 'text',
  content: { md },
  title: {},
  desc: {},
  command: '',
  level: 'required',
  why: {},
  subtasks: [],
  refs,
})

const step = (refs: ExportStep['refs']): ExportStep => ({
  n: 2,
  title: { ru: 'Шаг' },
  desc: {},
  command: '',
  level: 'required',
  why: {},
  subtasks: [],
  refs,
})

const list = (steps: ExportStep[]): ExportList => ({
  title: { ru: 'Список' },
  desc: {},
  tags: [],
  ordered: true,
  version: 1,
  ownerHandle: 'u',
  slug: 's',
  steps,
})

const DECREE = { label: { ru: 'Декрет — текст' }, url: 'https://ru.wikisource.org/wiki/a' }

describe('markdown-экспорт', () => {
  it('текст уходит вместе со своими источниками', () => {
    const md = toMarkdown(list([text('Первый документ.', [DECREE])]), 'ru')
    expect(md).toContain('Первый документ.')
    expect(md).toContain('- [Декрет — текст](https://ru.wikisource.org/wiki/a)')
    expect(md.indexOf('- [Декрет')).toBeGreaterThan(md.indexOf('Первый документ.'))
  })

  it('текст только со ссылками не пропадает', () => {
    expect(toMarkdown(list([text('', [DECREE])]), 'ru')).toContain('- [Декрет — текст](https://ru.wikisource.org/wiki/a)')
  })

  it('ссылка одним адресом у шага не теряется — автоссылка', () => {
    expect(toMarkdown(list([step([{ label: {}, url: 'https://example.org/only' }])]), 'ru')).toContain('- <https://example.org/only>')
  })
})

describe('HTML-экспорт', () => {
  it('текст уходит вместе со своими источниками', () => {
    const html = toHtml(list([text('Первый документ.', [DECREE])]), 'ru')
    expect(html).toContain('<ul class="refs"><li><a href="https://ru.wikisource.org/wiki/a">Декрет — текст</a></li></ul>')
  })

  it('текст только со ссылками не пропадает', () => {
    expect(toHtml(list([text('', [DECREE])]), 'ru')).toContain('Декрет — текст</a>')
  })

  it('ссылка одним адресом у шага не теряется — текстом ссылки идёт адрес', () => {
    expect(toHtml(list([step([{ label: {}, url: 'https://example.org/only' }])]), 'ru')).toContain(
      '<a href="https://example.org/only">https://example.org/only</a>',
    )
  })
})

describe('Code-дифф ревью версии и правки', () => {
  const txt = (refs: CmpStep['refs']): CmpStep => ({
    type: 'text',
    content: { md: 'Первый документ.' },
    title: '',
    desc: '',
    command: '',
    level: 'required',
    why: '',
    subtasks: [],
    refs,
  })

  it('смена одних ссылок текста видна ревьюеру', () => {
    // Было: сериализация выходила из ветки текста раньше ссылок, обе версии давали
    // одинаковый текст, и дифф сообщал «изменений нет».
    const before = serializeSteps([txt([{ label: 'Декрет', url: 'https://ru.wikisource.org/wiki/a' }])], true)
    const after = serializeSteps([txt([{ label: 'Декрет', url: 'https://ru.wikisource.org/wiki/b' }])], true)
    const d = lineDiff(before, after)
    expect(d.added + d.removed).toBeGreaterThan(0)
  })
})
