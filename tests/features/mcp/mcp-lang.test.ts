import { describe, expect, it } from 'vitest'
import { mcpLang } from '@/features/mcp/tools/shared'

/**
 * На каком языке MCP читает и пишет список (ADR-0030): язык оригинала; не определён — язык,
 * под которым лежит заголовок; нет и его — прежнее `en`.
 */
describe('mcpLang', () => {
  it('язык оригинала решает, даже если заголовок переведён', () => {
    expect(mcpLang({ lang: 'be', title: { be: 'Суп', en: 'Soup' } })).toBe('be')
  })

  it('язык не определён — ключ заголовка', () => {
    expect(mcpLang({ lang: null, title: { uk: 'Як спекти хліб' } })).toBe('uk')
  })

  it('мусор в колонке языка не проходит — берётся заголовок', () => {
    expect(mcpLang({ lang: 'xx', title: { ru: 'Борщ' } })).toBe('ru')
  })

  it('нет ни языка, ни заголовка — en', () => {
    expect(mcpLang({ lang: null, title: {} })).toBe('en')
    expect(mcpLang({})).toBe('en')
  })
})
