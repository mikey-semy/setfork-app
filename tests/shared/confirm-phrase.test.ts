import { describe, expect, it } from 'vitest'
import { confirmMatches } from '@/shared/lib/confirm-phrase'

describe('confirmMatches', () => {
  it('точное совпадение', () => {
    expect(confirmMatches('mike/zefir', 'mike/zefir')).toBe(true)
  })
  it('регистронезависимо + trim + схлопывание пробелов', () => {
    expect(confirmMatches('  Mike / Zefir ', 'mike/zefir')).toBe(true)
    expect(confirmMatches('MIKE', 'mike')).toBe(true)
  })
  it('несовпадение → false', () => {
    expect(confirmMatches('mike/zefi', 'mike/zefir')).toBe(false)
    expect(confirmMatches('other/zefir', 'mike/zefir')).toBe(false)
  })
  it('пустая ожидаемая фраза никогда не матчится (защита от «пусто == пусто»)', () => {
    expect(confirmMatches('', '')).toBe(false)
    expect(confirmMatches('   ', '')).toBe(false)
  })
})
