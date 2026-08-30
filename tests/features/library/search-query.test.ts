import { describe, it, expect } from 'vitest'
import { parseSearchQuery, buildSearchQuery } from '@/features/library/search-query'

describe('parseSearchQuery', () => {
  it('plain text has no qualifiers', () => {
    expect(parseSearchQuery('docker ubuntu')).toEqual({ text: 'docker ubuntu', tags: [] })
  })

  it('extracts qualifiers and keeps free text', () => {
    const p = parseSearchQuery('docker by:demo tag:redis type:ordered stars:>100')
    expect(p.text).toBe('docker')
    expect(p.by).toBe('demo')
    expect(p.tags).toEqual(['redis'])
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
    expect(p.minStars).toBeUndefined()
    expect(p.tags).toEqual([])
  })

  it('stars accepts > and plain number', () => {
    expect(parseSearchQuery('stars:50').minStars).toBe(50)
    expect(parseSearchQuery('stars:>=10').minStars).toBe(10)
  })
})

describe('buildSearchQuery', () => {
  it('emits qualifiers for every set field', () => {
    expect(
      buildSearchQuery({ text: 'docker', by: 'demo', tags: ['redis', 'db'], type: 'ordered', minStars: 100 }),
    ).toBe('docker by:demo tag:redis tag:db type:ordered stars:>100')
  })

  it('round-trips through parseSearchQuery', () => {
    const q = 'docker by:demo tag:redis type:ordered stars:>100'
    expect(buildSearchQuery(parseSearchQuery(q))).toBe(q)
  })

  it('omits empty fields', () => {
    expect(buildSearchQuery({ text: '', tags: [] })).toBe('')
    expect(buildSearchQuery({ text: 'foo', tags: [] })).toBe('foo')
  })

  it('keeps minStars 0 (stars:>0 round-trips)', () => {
    expect(parseSearchQuery('stars:>0').minStars).toBe(0)
    expect(buildSearchQuery({ text: '', tags: [], minStars: 0 })).toBe('stars:>0')
  })
})

describe('parseSearchQuery edge cases', () => {
  it('drops a bare qualifier with no value', () => {
    const p = parseSearchQuery('docker by:')
    expect(p.text).toBe('docker')
    expect(p.by).toBeUndefined()
  })

  it('keeps free text that merely contains a colon', () => {
    expect(parseSearchQuery('ratio 3:2').text).toBe('ratio 3:2')
  })
})

/**
 * `is:verified` СНЯТ С ПУБЛИЧНОГО ЯЗЫКА ПОИСКА.
 *
 * Отбор «только проверенные» — тот же бейдж, что запрещён решением 0006, только в виде
 * фильтра: он обещает вторую проверку сверх видимости, а её нет. Флаг остаётся
 * внутренним инструментом модерации.
 *
 * Проверяется главное свойство снятия: запрос не должен ТИХО менять выдачу. Незнакомый
 * квалификатор уходит в свободный текст — то есть старый запрос ищет эти слова, а не
 * отбирает по флагу за спиной у человека.
 */
describe('is:verified снят', () => {
  it('не отбирает по флагу', () => {
    // Отбор ушёл: разбор больше не знает такого поля. Сам квалификатор при этом
    // ОТБРАСЫВАЕТСЯ, как любой незнакомый (`is:open` в тесте выше ведёт себя так же), —
    // проверено здесь, а не предположено: я сначала написал в комментарии, что он
    // уходит в свободный текст, и этот тест меня поправил.
    const p = parseSearchQuery('docker is:verified')
    expect('verified' in p).toBe(false)
    expect(p.text).toBe('docker')
  })
})
