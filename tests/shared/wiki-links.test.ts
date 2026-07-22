import { describe, expect, it } from 'vitest'
import { extractWikiRefs, renderWikiLinks } from '@/shared/lib/wiki-links'

describe('extractWikiRefs', () => {
  it('находит [[handle/slug]], без дублей, lowercase', () => {
    const refs = extractWikiRefs('см. [[Toshkin-Mikhail/borsch]] и снова [[toshkin-mikhail/BORSCH]], а ещё [[acme/deploy-vps]]')
    expect(refs).toEqual([
      { handle: 'toshkin-mikhail', slug: 'borsch' },
      { handle: 'acme', slug: 'deploy-vps' },
    ])
  })

  it('мусор не матчится: пробелы, пустые части, обычные ссылки', () => {
    expect(extractWikiRefs('[[a b/c]] [[/slug]] [[handle/]] [обычная](https://x.y)')).toEqual([])
  })
})

describe('renderWikiLinks', () => {
  it('превращает в markdown-ссылку с честным адресом', () => {
    expect(renderWikiLinks('см. [[acme/deploy-vps]]')).toBe('см. [acme/deploy-vps](/acme/deploy-vps)')
  })

  it('текст без вики-ссылок не меняется', () => {
    const t = 'обычный **markdown** и [ссылка](/a/b)'
    expect(renderWikiLinks(t)).toBe(t)
  })
})
