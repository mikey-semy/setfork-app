import { describe, expect, it } from 'vitest'
import { badgeFor, fmtCount, isBadgeKind, shield } from './svg'

describe('fmtCount', () => {
  it('formats thousands compactly', () => {
    expect(fmtCount(0)).toBe('0')
    expect(fmtCount(42)).toBe('42')
    expect(fmtCount(999)).toBe('999')
    expect(fmtCount(1000)).toBe('1k')
    expect(fmtCount(1200)).toBe('1.2k')
    expect(fmtCount(1050)).toBe('1k') // <100 остатка → без десятой
    expect(fmtCount(15400)).toBe('15.4k')
  })
})

describe('shield', () => {
  it('is well-formed SVG with escaped label/value', () => {
    const s = shield('stars', '1.2k', '#2159d6')
    expect(s.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(s.trimEnd().endsWith('</svg>')).toBe(true)
    expect(s).toContain('>stars<')
    expect(s).toContain('>1.2k<')
    expect(s).toContain('#2159d6')
  })
  it('escapes XML-sensitive chars', () => {
    const s = shield('a&b', '<x>', '#000')
    expect(s).toContain('a&amp;b')
    expect(s).toContain('&lt;x&gt;')
    expect(s).not.toMatch(/>a&b</)
  })
  it('wider value → wider svg', () => {
    const narrow = shield('v', '1', '#000')
    const wide = shield('v', 'verylongvalue', '#000')
    const wOf = (svg: string) => Number(svg.match(/width="(\d+)"/)![1])
    expect(wOf(wide)).toBeGreaterThan(wOf(narrow))
  })
})

describe('badgeFor', () => {
  const meta = { starsCount: 1200, forksCount: 3, runsCount: 0, version: 4 }
  it('renders each kind with right label/value', () => {
    expect(badgeFor('stars', meta)).toContain('>1.2k<')
    expect(badgeFor('forks', meta)).toContain('>forks<')
    expect(badgeFor('runs', meta)).toContain('>runs<')
    expect(badgeFor('version', meta)).toContain('>v4<')
    expect(badgeFor('version', meta)).toContain('>setfork<')
  })
})

describe('isBadgeKind', () => {
  it('validates kind', () => {
    expect(isBadgeKind('stars')).toBe(true)
    expect(isBadgeKind('version')).toBe(true)
    expect(isBadgeKind('nope')).toBe(false)
  })
})
