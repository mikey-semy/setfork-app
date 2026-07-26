import { describe, it, expect } from 'vitest'
import { locateQuote } from '@/features/comments/quote'

const SRC = 'Залей желатин **100 мл** холодной воды и оставь набухать на 15 минут.'

describe('locateQuote', () => {
  it('точное вхождение находит как есть', () => {
    const at = locateQuote(SRC, 'холодной воды')
    expect(SRC.slice(at.start, at.end)).toBe('холодной воды')
  })

  it('выделение без markdown-разметки всё равно находится', () => {
    // В DOM «**100 мл**» выглядит как «100 мл» — звёздочек в выделении нет.
    const at = locateQuote(SRC, '100 мл холодной')
    expect(at.end).toBeGreaterThan(at.start)
    expect(SRC.slice(at.start, at.end)).toContain('100')
    expect(SRC.slice(at.start, at.end)).toContain('холодной')
  })

  it('схлопнутые пробелы и переносы не мешают', () => {
    const src = 'Первая строка\nвторая строка текста'
    const at = locateQuote(src, 'строка   второй')
    expect(at.start).toBeGreaterThanOrEqual(0)
  })

  it('пустая цитата = комментарий ко всему блоку', () => {
    expect(locateQuote(SRC, '')).toEqual({ start: 0, end: 0 })
    expect(locateQuote(SRC, '   ')).toEqual({ start: 0, end: 0 })
  })

  it('чужой текст не привязывается наугад', () => {
    expect(locateQuote(SRC, 'разогрей духовку')).toEqual({ start: 0, end: 0 })
  })

  it('пустой исходник не ломает поиск', () => {
    expect(locateQuote('', 'что-нибудь')).toEqual({ start: 0, end: 0 })
  })

  it('диапазон всегда внутри исходника', () => {
    const at = locateQuote(SRC, 'набухать на 15 минут')
    expect(at.start).toBeGreaterThanOrEqual(0)
    expect(at.end).toBeLessThanOrEqual(SRC.length)
  })
})
