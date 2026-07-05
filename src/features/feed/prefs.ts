// Настройки ленты dashboard: какие события показывать. Хранение — localStorage
// (клиентский фильтр по уже загруженной ленте; сервер отдаёт все типы).

export type FeedEventType =
  | 'version'
  | 'created'
  | 'forked'
  | 'star'
  | 'follow'
  | 'issue'
  | 'suggestion'
  | 'recommended' // блок «Recommended for you» в конце ленты

export interface FeedPrefs {
  events: Record<FeedEventType, boolean>
  includeStarred: boolean // события и по starred-спискам (не только watch)
}

export const DEFAULT_PREFS: FeedPrefs = {
  events: {
    version: true,
    created: true,
    forked: true,
    star: true,
    follow: true,
    issue: true,
    suggestion: true,
    recommended: true,
  },
  includeStarred: true,
}

const KEY = 'sf-feed-prefs'

export function loadPrefs(): FeedPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return DEFAULT_PREFS
    const p = JSON.parse(raw) as Partial<FeedPrefs>
    return {
      events: { ...DEFAULT_PREFS.events, ...(p.events ?? {}) },
      includeStarred: p.includeStarred ?? true,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export function savePrefs(p: FeedPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // квота/приватный режим — просто не сохраняем
  }
}
