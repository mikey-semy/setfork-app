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

  it('язык не определён, а заголовок переведён — оригинала не узнать, остаётся прежнее en', () => {
    // Честное ограничение: у такого списка MCP читает и пишет английский. Исправляется не
    // догадкой здесь, а языком у самого списка (настройки или перекладка ключей).
    expect(mcpLang({ lang: null, title: { ru: 'Борщ', en: 'Borscht' } })).toBe('en')
  })

  it('мусор в колонке языка не проходит — берётся заголовок', () => {
    expect(mcpLang({ lang: 'xx', title: { ru: 'Борщ' } })).toBe('ru')
  })

  it('нет ни языка, ни заголовка — en', () => {
    expect(mcpLang({ lang: null, title: {} })).toBe('en')
    expect(mcpLang({})).toBe('en')
  })
})
