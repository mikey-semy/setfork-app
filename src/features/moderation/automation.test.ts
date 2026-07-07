import { describe, it, expect } from 'vitest'
import {
  checkSpamHeuristics,
  contentFingerprint,
  categorySeverity,
  extractHosts,
  routeVerdict,
} from './automation'

const signals = (over: Partial<{ title: string; stepCount: number; text: string }> = {}) => ({
  title: 'Deploy a Node.js app',
  stepCount: 5,
  text: 'Deploy a Node.js app\n1. Install deps\n2. Build\n3. Ship',
  ...over,
})

describe('checkSpamHeuristics', () => {
  it('normal list passes', () => {
    expect(checkSpamHeuristics(signals()).spam).toBe(false)
  })
  it('empty list / no title are spam', () => {
    expect(checkSpamHeuristics(signals({ stepCount: 0 })).spam).toBe(true)
    expect(checkSpamHeuristics(signals({ title: 'a' })).spam).toBe(true)
  })
  it('url shorteners are spam', () => {
    const r = checkSpamHeuristics(signals({ text: 'click https://bit.ly/xyz now' }))
    expect(r.spam).toBe(true)
    expect(r.reason).toContain('bit.ly')
  })
  it('link farm (many distinct hosts) is spam, few links are fine', () => {
    const many = Array.from({ length: 12 }, (_, i) => `https://site${i}.com/x`).join(' ')
    expect(checkSpamHeuristics(signals({ text: many })).spam).toBe(true)
    const few = 'https://go.dev https://nodejs.org'
    expect(checkSpamHeuristics(signals({ text: few })).spam).toBe(false)
  })
})

describe('extractHosts', () => {
  it('dedupes and strips www', () => {
    expect(extractHosts('https://www.go.dev/doc https://go.dev/tour http://nodejs.org')).toEqual(['go.dev', 'nodejs.org'])
  })
})

describe('contentFingerprint', () => {
  it('is stable under cosmetic changes', () => {
    const a = contentFingerprint('Deploy to VPS!', ['Install Docker', 'Set up nginx'])
    const b = contentFingerprint('deploy   to vps', ['install docker!!', 'SET UP NGINX'])
    expect(a).toBe(b)
  })
  it('differs for different content', () => {
    expect(contentFingerprint('Deploy to VPS', ['Install Docker'])).not.toBe(
      contentFingerprint('Deploy to VPS', ['Install Podman']),
    )
  })
})

describe('categorySeverity', () => {
  it('severe MLCommons categories → 3, rest → 2', () => {
    expect(categorySeverity('S9 Indiscriminate Weapons')).toBe(3)
    expect(categorySeverity('S4 Child Sexual Exploitation')).toBe(3)
    expect(categorySeverity('S2 Non-Violent Crimes')).toBe(2)
    expect(categorySeverity('')).toBe(2)
  })
})

describe('routeVerdict', () => {
  const v = (flagged: boolean, confidence: number, category = '') => ({ flagged, confidence, category, reason: 'r' })

  it('gate: confident-safe approves, confident-unsafe flags', () => {
    expect(routeVerdict(v(false, 0.95), true)).toEqual({ action: 'approve' })
    const f = routeVerdict(v(true, 0.95, 'S9 Weapons'), true)
    expect(f.action).toBe('flag')
    if (f.action === 'flag') expect(f.severity).toBe(3)
  })
  it('gate: uncertainty goes to a human (hold)', () => {
    expect(routeVerdict(v(false, 0.5), true).action).toBe('hold')
    expect(routeVerdict(v(true, 0.5), true).action).toBe('hold')
  })
  it('recheck (live list): only confident-unsafe takes it down', () => {
    expect(routeVerdict(v(true, 0.95, 'S2'), false).action).toBe('flag')
    expect(routeVerdict(v(true, 0.5), false).action).toBe('none') // не роняем живой список по неуверенности
    expect(routeVerdict(v(false, 0.95), false).action).toBe('none')
  })
})
