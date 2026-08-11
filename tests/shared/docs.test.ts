import { describe, expect, it } from 'vitest'
import { DOCS_URL, docsUrl, legalUrl } from '@/shared/docs'

// В доках язык по умолчанию — русский (без префикса), английский под /en.
// Тест фиксирует именно это: перепутанный префикс уводил бы русского
// пользователя на английские Terms и наоборот.
describe('docsUrl', () => {
  it('русский — без языкового префикса', () => {
    expect(docsUrl('/docs/quickstart', 'ru')).toBe(`${DOCS_URL}/docs/quickstart`)
  })

  it('английский — под /en', () => {
    expect(docsUrl('/docs/quickstart', 'en')).toBe(`${DOCS_URL}/en/docs/quickstart`)
  })

  it('домен берётся из DOCS_URL, лишнего слэша после хоста нет', () => {
    const url = docsUrl('/docs', 'ru')
    expect(url.startsWith(DOCS_URL)).toBe(true)
    // после хоста ровно один слэш: ...setfork.com/docs, не ...setfork.com//docs
    expect(url.slice(DOCS_URL.length)).toBe('/docs')
  })
})

describe('legalUrl', () => {
  it('юр-страницы собираются под нужный язык', () => {
    expect(legalUrl('terms', 'ru')).toBe(`${DOCS_URL}/docs/legal/terms`)
    expect(legalUrl('privacy', 'en')).toBe(`${DOCS_URL}/en/docs/legal/privacy`)
    expect(legalUrl('copyright', 'ru')).toBe(`${DOCS_URL}/docs/legal/copyright`)
  })
})
