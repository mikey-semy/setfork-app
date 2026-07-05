// Достижения профиля (как GitHub achievements): чистая функция от агрегатов.
// Без server-only — тестируется в node напрямую. Локализация — в компоненте.

export interface AchievementInput {
  listsAuthored: number
  starsReceived: number
  forksReceived: number
  runsStarted: number
  contributions: { date: string; count: number }[] // для серии дней
}

export type AchievementKey = 'first-list' | 'prolific' | 'starred' | 'forked' | 'runner' | 'streak'

export interface Achievement {
  key: AchievementKey
  earned: boolean
  /** Текущий прогресс к следующему порогу (для незаработанных). */
  progress: number
  goal: number
  /** Достигнутый «уровень» (для многоуровневых) — сколько порогов пройдено. */
  tier: number
}

/** Самая длинная серия подряд идущих дней с count>0. */
export function longestStreak(contributions: { date: string; count: number }[]): number {
  const active = contributions
    .filter((c) => c.count > 0)
    .map((c) => c.date)
    .sort()
  let best = 0
  let cur = 0
  let prev: number | null = null
  for (const d of active) {
    const day = Math.floor(new Date(d + 'T00:00:00Z').getTime() / 86_400_000)
    cur = prev !== null && day - prev === 1 ? cur + 1 : 1
    prev = day
    if (cur > best) best = cur
  }
  return best
}

// Пороги многоуровневых достижений (tier = сколько пройдено).
const TIERS: Partial<Record<AchievementKey, number[]>> = {
  starred: [10, 50, 200], // звёзд получено
  forked: [1, 5, 25], // форков получено
  runner: [1, 10, 50], // прогонов запущено
  streak: [3, 7, 30], // серия дней активности
}

function tiered(key: AchievementKey, value: number): Achievement {
  const tiers = TIERS[key]!
  const tier = tiers.filter((t) => value >= t).length
  const goal = tiers[Math.min(tier, tiers.length - 1)]
  return { key, earned: tier > 0, progress: Math.min(value, goal), goal, tier }
}

function once(key: AchievementKey, ok: boolean, value = ok ? 1 : 0): Achievement {
  return { key, earned: ok, progress: value, goal: 1, tier: ok ? 1 : 0 }
}

export function computeAchievements(input: AchievementInput): Achievement[] {
  const streak = longestStreak(input.contributions)
  return [
    once('first-list', input.listsAuthored >= 1, Math.min(input.listsAuthored, 1)),
    once('prolific', input.listsAuthored >= 10, input.listsAuthored),
    tiered('starred', input.starsReceived),
    tiered('forked', input.forksReceived),
    tiered('runner', input.runsStarted),
    tiered('streak', streak),
  ]
}
