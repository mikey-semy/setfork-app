import { describe, expect, it } from 'vitest'
import { extractUrls, normalizeUrl, urlHost, walkStrings } from '@/core'

describe('normalizeUrl', () => {
  it('убирает fragment, лower-кейсит хост, режет дефолтный порт и голый «/»', () => {
    expect(normalizeUrl('HTTPS://Example.COM:443/#intro')).toBe('https://example.com')
    expect(normalizeUrl('http://a.b:80/path/#x')).toBe('http://a.b/path/')
  })
  it('query сохраняется (другой ресурс)', () => {
    expect(normalizeUrl('https://a.b/?q=1#f')).toBe('https://a.b/?q=1')
  })
  it('мусор и не-http → null', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('ftp://a.b/x')).toBeNull()
    expect(normalizeUrl('not a url')).toBeNull()
    expect(normalizeUrl('https://a.b/' + 'x'.repeat(3000))).toBeNull()
  })
})

describe('extractUrls', () => {
  it('находит URL в markdown и чистит хвостовую пунктуацию', () => {
    const md = 'См. [доку](https://docs.a.b/guide). Или https://b.c/page, потом сюда: https://c.d!'
    expect(extractUrls(md)).toEqual(['https://docs.a.b/guide', 'https://b.c/page', 'https://c.d'])
  })
  it('markdown-скобка не съедается, незакрытая — срезается', () => {
    expect(extractUrls('(https://a.b/x)')).toEqual(['https://a.b/x'])
    expect(extractUrls('[y](https://a.b/wiki_(z))')).toEqual(['https://a.b/wiki_(z)'])
  })
  it('без URL — пусто', () => {
    expect(extractUrls('просто текст без ссылок')).toEqual([])
  })
})

describe('walkStrings', () => {
  it('собирает строковые листья вложенного JSON (блоки, subtasks)', () => {
    const v = { md: 'a', deep: { arr: ['b', { x: 'c' }] }, n: 5, empty: '' }
    expect(walkStrings(v)).toEqual(['a', 'b', 'c'])
  })
})

describe('urlHost', () => {
  it('хост нормализованного URL; мусор → пустая строка', () => {
    expect(urlHost('https://sub.example.com/x')).toBe('sub.example.com')
    expect(urlHost('мусор')).toBe('')
  })
})
