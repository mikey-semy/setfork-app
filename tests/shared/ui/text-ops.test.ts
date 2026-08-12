import { describe, expect, it } from 'vitest'
import { indentLines, insertText, prefixLines, surroundText } from '@/shared/ui/text-ops'

// Операции правки текста — общие для MarkdownEditor и BubbleTextEditor. Раньше они
// были в обоих скопированы и не проверялись ничем: сломать выделение можно было
// незаметно, потому что «текст получился правильный», а каретка уезжала.

describe('surroundText', () => {
  it('оборачивает выделение и оставляет выделенным именно его', () => {
    const r = surroundText('привет мир', 7, 10, '**', '**')
    expect(r.text).toBe('привет **мир**')
    expect(r.text.slice(r.selStart, r.selEnd)).toBe('мир')
  })

  it('на пустом выделении вставляет подсказку и выделяет её — чтобы сразу набрать своё', () => {
    const r = surroundText('', 0, 0, '**', '**', 'текст')
    expect(r.text).toBe('**текст**')
    expect(r.text.slice(r.selStart, r.selEnd)).toBe('текст')
  })

  it('несимметричная пара (ссылка) не ломает границы выделения', () => {
    const r = surroundText('см. тут', 4, 7, '[', '](url)')
    expect(r.text).toBe('см. [тут](url)')
    expect(r.text.slice(r.selStart, r.selEnd)).toBe('тут')
  })
})

describe('prefixLines', () => {
  it('дописывает префикс каждой строке выделения', () => {
    const r = prefixLines('раз\nдва\nтри', 0, 11, () => '- ')
    expect(r.text).toBe('- раз\n- два\n- три')
  })

  it('нумерует по порядку строк', () => {
    const r = prefixLines('раз\nдва', 0, 7, (i) => `${i + 1}. `)
    expect(r.text).toBe('1. раз\n2. два')
  })

  it('берёт строку с НАЧАЛА, даже если каретка стоит в её середине', () => {
    const r = prefixLines('раз\nдва', 5, 5, () => '> ')
    expect(r.text).toBe('раз\n> два')
  })
})

describe('insertText', () => {
  it('заменяет выделение и ставит каретку после вставленного', () => {
    const r = insertText('раз два', 4, 7, 'три')
    expect(r.text).toBe('раз три')
    expect(r.selStart).toBe(r.selEnd)
    expect(r.text.slice(0, r.selStart)).toBe('раз три')
  })
})

describe('indentLines', () => {
  it('без выделения Tab — это отступ в позиции каретки, а не сдвиг строки', () => {
    const r = indentLines('раз', 3, 3, false)
    expect(r.text).toBe('раз  ')
  })

  it('с выделением сдвигает все строки блока', () => {
    const r = indentLines('раз\nдва', 0, 7, false)
    expect(r.text).toBe('  раз\n  два')
  })

  it('Shift+Tab снимает отступ и не трогает строки без него', () => {
    const r = indentLines('  раз\nдва', 0, 9, true)
    expect(r.text).toBe('раз\nдва')
  })

  it('Shift+Tab снимает не больше одного отступа за раз', () => {
    const r = indentLines('      раз', 0, 9, true)
    expect(r.text).toBe('    раз')
  })
})
