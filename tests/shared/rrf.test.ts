import { describe, expect, it } from 'vitest'
import { rrf } from '@/shared/ai/rrf'

const k = (x: { id: string }) => x.id

describe('rrf', () => {
  it('документ, сильный в обеих ветках, всплывает выше лидера одной', () => {
    const vec = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const lex = [{ id: 'b' }, { id: 'd' }]
    // b: 1/62+1/61 > a: 1/61 > d: 1/62 (ранг 2 в lex) > c: 1/63 (ранг 3 в vec)
    expect(rrf(vec, lex, k).map(k)).toEqual(['b', 'a', 'd', 'c'])
  })

  it('пустая ветка (эмбеддинги выключены) — выдача равна другой ветке', () => {
    const lex = [{ id: 'x' }, { id: 'y' }]
    expect(rrf([], lex, k).map(k)).toEqual(['x', 'y'])
  })

  it('дубликаты схлопываются по ключу, порядок стабилен', () => {
    const a = [{ id: 'a' }]
    expect(rrf(a, a, k)).toHaveLength(1)
  })
})
