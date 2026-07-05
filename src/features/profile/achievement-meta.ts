import { Flame, GitFork, PlayCircle, Sparkles, Star, Trophy } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AchievementKey } from './achievements'

// Иконка (fallback, когда админ не загрузил свою картинку), название и цвет
// каждого достижения. Общий источник для профильной карточки и админки.
export const ACH_META: Record<AchievementKey, { icon: LucideIcon; ru: string; en: string; color: string }> = {
  'first-list': { icon: Sparkles, ru: 'Первый список', en: 'First list', color: 'text-accent' },
  prolific: { icon: Trophy, ru: 'Плодовитый (10+ списков)', en: 'Prolific (10+ lists)', color: 'text-warn' },
  starred: { icon: Star, ru: 'Со звёздами', en: 'Starstruck', color: 'text-warn' },
  forked: { icon: GitFork, ru: 'Форкнутый', en: 'Forked', color: 'text-ink-2' },
  runner: { icon: PlayCircle, ru: 'Раннер', en: 'Runner', color: 'text-ok' },
  streak: { icon: Flame, ru: 'Серия дней', en: 'On a streak', color: 'text-danger' },
}
