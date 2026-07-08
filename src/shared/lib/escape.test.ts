import { describe, it, expect } from 'vitest'
import { escapeHtml } from './escape'

describe('escapeHtml', () => {
  it('экранирует все 5 значимых символов, включая апостроф', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('закрывает attribute-breakout в обоих типах кавычек', () => {
    expect(escapeHtml('x" onmouseover="alert(1)')).not.toContain('"')
    expect(escapeHtml("x' onmouseover='alert(1)")).not.toContain("'")
  })

  it('обычный текст не трогает', () => {
    expect(escapeHtml('hello world 42')).toBe('hello world 42')
  })
})
