import { describe, it, expect } from 'vitest'
import { safeHref } from './safe-url'

describe('safeHref', () => {
  it('пропускает http/https/mailto/tel', () => {
    expect(safeHref('https://example.com/x?q=1')).toBe('https://example.com/x?q=1')
    expect(safeHref('http://a.b')).toBe('http://a.b')
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(safeHref('tel:+1234')).toBe('tel:+1234')
  })

  it('пропускает относительные ссылки и якоря (напр. /uploads/…)', () => {
    expect(safeHref('/uploads/f.pdf')).toBe('/uploads/f.pdf')
    expect(safeHref('#top')).toBe('#top')
    expect(safeHref('./rel/path')).toBe('./rel/path')
  })

  it('режет javascript: во всех регистрах и с обфускацией control-символами', () => {
    expect(safeHref('javascript:alert(1)')).toBe('')
    expect(safeHref('JavaScript:alert(document.domain)')).toBe('')
    expect(safeHref('  javascript:alert(1)')).toBe('')
    expect(safeHref('java\tscript:alert(1)')).toBe('')
    expect(safeHref('java\nscript:alert(1)')).toBe('')
    expect(safeHref('javascript:alert(1)')).toBe('')
  })

  it('режет data:/vbscript:/file: и прочие небезопасные схемы', () => {
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBe('')
    expect(safeHref('vbscript:msgbox(1)')).toBe('')
    expect(safeHref('file:///etc/passwd')).toBe('')
  })

  it('пусто/nullish → пустая строка', () => {
    expect(safeHref('')).toBe('')
    expect(safeHref('   ')).toBe('')
    expect(safeHref(null)).toBe('')
    expect(safeHref(undefined)).toBe('')
  })
})
