import { Flame, GitFork, PlayCircle, Sparkles, Star, Trophy } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AchievementKey } from './achievements'

// Иконка (fallback, когда админ не загрузил свою картинку), название и цвет
// каждого достижения. Общий источник для профильной карточки и админки.
export interface AchMeta {
  icon: LucideIcon
  ru: string
  en: string
  color: string
  descRu: string
  descEn: string
  /** Единица метрики уровней — для строк истории («10 звёзд», «7 дней подряд»). */
  unitRu: string
  unitEn: string
}

export const ACH_META: Record<AchievementKey, AchMeta> = {
  'first-list': { icon: Sparkles, ru: 'Первый список', en: 'First list', color: 'text-accent', descRu: 'Опубликован первый список.', descEn: 'Published a first list.', unitRu: 'список', unitEn: 'list' },
  prolific: { icon: Trophy, ru: 'Плодовитый', en: 'Prolific', color: 'text-warn', descRu: 'Опубликовано 10+ списков.', descEn: 'Published 10+ lists.', unitRu: 'списков', unitEn: 'lists' },
  starred: { icon: Star, ru: 'Со звёздами', en: 'Starstruck', color: 'text-warn', descRu: 'Списки получили звёзды сообщества.', descEn: 'Lists earned stars from the community.', unitRu: 'звёзд', unitEn: 'stars' },
  forked: { icon: GitFork, ru: 'Форкнутый', en: 'Forked', color: 'text-ink-2', descRu: 'Списки форкнули другие пользователи.', descEn: 'Lists were forked by others.', unitRu: 'форков', unitEn: 'forks' },
  runner: { icon: PlayCircle, ru: 'Раннер', en: 'Runner', color: 'text-ok', descRu: 'Запущены прогоны списков.', descEn: 'Started list runs.', unitRu: 'прогонов', unitEn: 'runs' },
  streak: { icon: Flame, ru: 'Серия дней', en: 'On a streak', color: 'text-danger', descRu: 'Серия дней подряд с активностью.', descEn: 'A streak of consecutive active days.', unitRu: 'дней подряд', unitEn: 'day streak' },
}
