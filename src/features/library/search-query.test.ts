import { describe, it, expect } from 'vitest'
import { parseSearchQuery } from './search-query'

describe('parseSearchQuery', () => {
  it('plain text has no qualifiers', () => {
    expect(parseSearchQuery('docker ubuntu')).toEqual({ text: 'docker ubuntu', tags: [] })
  })

  it('extracts qualifiers and keeps free text', () => {
    const p = parseSearchQuery('docker by:demo tag:redis is:verified type:ordered stars:>100')
    expect(p.text).toBe('docker')
    expect(p.by).toBe('demo')
    expect(p.tags).toEqual(['redis'])
    expect(p.verified).toBe(true)
    expect(p.type).toBe('ordered')
    expect(p.minStars).toBe(100)
  })

  it('supports owner/author aliases and @, multiple tags', () => {
    const p = parseSearchQuery('by:@Mike tag:a topic:b author:x')
    expect(p.by).toBe('x') // последний выигрывает
    expect(p.tags).toEqual(['a', 'b'])
  })

  it('ignores unknown/empty and bad values', () => {
    const p = parseSearchQuery('foo type:weird is:open stars:abc tag:')
    expect(p.text).toBe('foo')
    expect(p.type).toBeUndefined()
    expect(p.verified).toBeUndefined()
    expect(p.minStars).toBeUndefined()
    expect(p.tags).toEqual([])
  })

  it('stars accepts > and plain number', () => {
    expect(parseSearchQuery('stars:50').minStars).toBe(50)
    expect(parseSearchQuery('stars:>=10').minStars).toBe(10)
  })
})
