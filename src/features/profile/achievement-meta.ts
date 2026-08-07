import { Flame, GitFork, PlayCircle, Sparkles, Star, Trophy } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { TKey } from '@/shared/i18n'
import type { AchievementKey } from './achievements'

// Иконка (fallback, когда админ не загрузил свою картинку), название и цвет
// каждого достижения. Общий источник для профильной карточки и админки.
export interface AchMeta {
  icon: LucideIcon
  color: string
  /** Название, пояснение и единица счёта — ключами словаря: это пользовательский
   *  текст, и держать его двумя полями на язык значит переписывать карту при
   *  добавлении каждого нового языка. */
  label: TKey
  desc: TKey
  unit: TKey
}

export const ACH_META: Record<AchievementKey, AchMeta> = {
  'first-list': { icon: Sparkles, color: 'text-accent', label: 'ach.firstList', desc: 'ach.firstListDesc', unit: 'ach.firstListUnit' },
  'prolific': { icon: Trophy, color: 'text-warn', label: 'ach.prolific', desc: 'ach.prolificDesc', unit: 'ach.prolificUnit' },
  'starred': { icon: Star, color: 'text-warn', label: 'ach.starred', desc: 'ach.starredDesc', unit: 'ach.starredUnit' },
  'forked': { icon: GitFork, color: 'text-ink-2', label: 'ach.forked', desc: 'ach.forkedDesc', unit: 'ach.forkedUnit' },
  'runner': { icon: PlayCircle, color: 'text-ok', label: 'ach.runner', desc: 'ach.runnerDesc', unit: 'ach.runnerUnit' },
  'streak': { icon: Flame, color: 'text-danger', label: 'ach.streak', desc: 'ach.streakDesc', unit: 'ach.streakUnit' },
}
