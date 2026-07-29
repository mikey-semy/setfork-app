import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SuggestionResult } from '@/features/library/SuggestionResult'
import type { ProposedItem } from '@/shared/db'

/**
 * ИТОГ ПРАВКИ обязан показывать то, что получится после принятия.
 *
 * Не-step блоки (картинка, видео, файл, товары, опрос, тест) проваливались в
 * рендер ШАГА: у них нет content.md, и предпросмотр рисовал пустую строчку с
 * маркером и бейджем уровня. Рецензент одобрял не то, что видел.
 */
const block = (type: string, content: Record<string, unknown>): ProposedItem =>
  ({ type, content, title: {}, desc: {}, level: 'required', why: {}, section: {}, subtasks: [], refs: [] }) as unknown as ProposedItem

const html = (items: ProposedItem[]) => renderToStaticMarkup(<SuggestionResult items={items} lang="ru" />)

describe('предпросмотр не-step блоков', () => {
  it('картинка показывает подпись, а не пустую строку шага', () => {
    expect(html([block('image', { caption: 'Схема сборки' })])).toContain('Схема сборки')
  })

  it('видео показывает подпись или адрес', () => {
    expect(html([block('video', { url: 'https://example.com/v' })])).toContain('example.com/v')
  })

  it('файл показывает имя', () => {
    expect(html([block('file', { fileName: 'смета.pdf' })])).toContain('смета.pdf')
  })

  it('товары перечисляются по названиям', () => {
    const out = html([block('product', { items: [{ name: 'Дрель' }, { name: 'Свёрла' }] })])
    expect(out).toContain('Дрель')
    expect(out).toContain('Свёрла')
  })

  it('опрос показывает вопрос и варианты', () => {
    const out = html([block('poll', { question: 'Какой цвет?', options: [{ text: 'Синий' }, { text: 'Зелёный' }] })])
    expect(out).toContain('Какой цвет?')
    expect(out).toContain('Зелёный')
  })

  it('тест показывает вопрос и варианты, но НЕ помечает верный', () => {
    const out = html([block('quiz', { question: '2+2?', options: [{ text: '4', correct: true }, { text: '5' }] })])
    expect(out).toContain('2+2?')
    expect(out).toContain('4')
    // Рецензент читает вопрос, а не проходит тест: подсказки «верно» в разметке нет.
    expect(out).not.toContain('correct')
  })

  it('текстовый блок по-прежнему показывает свой текст', () => {
    // Разметку markdown собирает клиентский компонент, в статическом рендере её нет —
    // проверяем то, ради чего тест: содержимое блока на месте, а не пустая заготовка.
    expect(html([block('text', { md: 'важный абзац' })])).toContain('важный абзац')
  })
})
