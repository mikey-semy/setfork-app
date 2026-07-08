import { describe, expect, it } from 'vitest'
import { computeAchievements, longestStreak, type AchievementKey } from '@/features/profile/achievements'

const get = (list: ReturnType<typeof computeAchievements>, k: AchievementKey) => list.find((a) => a.key === k)!

describe('longestStreak', () => {
  it('finds the longest run of consecutive active days', () => {
    expect(longestStreak([])).toBe(0)
    expect(longestStreak([{ date: '2026-01-01', count: 0 }])).toBe(0)
    expect(
      longestStreak([
        { date: '2026-01-01', count: 2 },
        { date: '2026-01-02', count: 1 },
        { date: '2026-01-03', count: 5 },
        { date: '2026-01-05', count: 1 }, // разрыв 04-го
        { date: '2026-01-06', count: 1 },
      ]),
    ).toBe(3)
  })
  it('ignores order of input', () => {
    expect(
      longestStreak([
        { date: '2026-01-03', count: 1 },
        { date: '2026-01-01', count: 1 },
        { date: '2026-01-02', count: 1 },
      ]),
    ).toBe(3)
  })
})

describe('computeAchievements', () => {
  const empty = { listsAuthored: 0, starsReceived: 0, forksReceived: 0, runsStarted: 0, contributions: [] }

  it('nothing earned for a blank profile', () => {
    const a = computeAchievements(empty)
    expect(a.every((x) => !x.earned)).toBe(true)
    expect(get(a, 'first-list').goal).toBe(1)
  })

  it('first-list earned at 1, prolific at 10', () => {
    expect(get(computeAchievements({ ...empty, listsAuthored: 1 }), 'first-list').earned).toBe(true)
    expect(get(computeAchievements({ ...empty, listsAuthored: 3 }), 'prolific').earned).toBe(false)
    expect(get(computeAchievements({ ...empty, listsAuthored: 10 }), 'prolific').earned).toBe(true)
  })

  it('tiered starred advances tier by thresholds', () => {
    expect(get(computeAchievements({ ...empty, starsReceived: 5 }), 'starred').tier).toBe(0)
    const t1 = get(computeAchievements({ ...empty, starsReceived: 12 }), 'starred')
    expect(t1.tier).toBe(1)
    expect(t1.earned).toBe(true)
    expect(t1.goal).toBe(50) // следующий порог
    expect(get(computeAchievements({ ...empty, starsReceived: 300 }), 'starred').tier).toBe(3)
  })

  it('streak achievement uses contributions', () => {
    const contribs = ['2026-02-01', '2026-02-02', '2026-02-03'].map((date) => ({ date, count: 1 }))
    const a = get(computeAchievements({ ...empty, contributions: contribs }), 'streak')
    expect(a.earned).toBe(true) // порог 3
    expect(a.tier).toBe(1)
  })

  it('returns a stable set of achievement keys', () => {
    expect(computeAchievements(empty).map((a) => a.key)).toEqual([
      'first-list',
      'prolific',
      'starred',
      'forked',
      'runner',
      'streak',
    ])
  })
})
