import { Award, Flame, GitFork, PlayCircle, Sparkles, Star, Trophy } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import type { Lang } from '@/shared/i18n'
import { computeAchievements, type AchievementInput, type AchievementKey } from './achievements'

const META: Record<AchievementKey, { icon: LucideIcon; ru: string; en: string; color: string }> = {
  'first-list': { icon: Sparkles, ru: 'Первый список', en: 'First list', color: 'text-accent' },
  prolific: { icon: Trophy, ru: 'Плодовитый (10+ списков)', en: 'Prolific (10+ lists)', color: 'text-warn' },
  starred: { icon: Star, ru: 'Со звёздами', en: 'Starstruck', color: 'text-warn' },
  forked: { icon: GitFork, ru: 'Форкнутый', en: 'Forked', color: 'text-ink-2' },
  runner: { icon: PlayCircle, ru: 'Раннер', en: 'Runner', color: 'text-ok' },
  streak: { icon: Flame, ru: 'Серия дней', en: 'On a streak', color: 'text-danger' },
}

/** Достижения на Overview профиля: заработанные ярко, прочие — приглушённо с прогрессом. */
export function AchievementsCard({ input, lang }: { input: AchievementInput; lang: Lang }) {
  const ru = lang === 'ru'
  const all = computeAchievements(input)
  const earned = all.filter((a) => a.earned)
  if (earned.length === 0) return null // пустому профилю не показываем

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <Award size={14} className="text-muted" /> {ru ? 'Достижения' : 'Achievements'}
        <Badge variant="soft" className="ml-1">
          {earned.length}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {all.map((a) => {
          const m = META[a.key]
          const Icon = m.icon
          const label = ru ? m.ru : m.en
          return (
            <div
              key={a.key}
              title={a.earned ? label : `${label} — ${a.progress}/${a.goal}`}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-2 ${
                a.earned ? 'border-border bg-surface-2' : 'border-dashed border-border opacity-55'
              }`}
            >
              <Icon size={16} className={a.earned ? m.color : 'text-muted'} />
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-semibold text-ink">{label}</span>
                {a.earned && a.tier > 1 ? (
                  <span className="block font-mono text-[10px] text-muted">
                    {ru ? 'ур.' : 'lvl'} {a.tier}
                  </span>
                ) : !a.earned ? (
                  <span className="block font-mono text-[10px] text-muted">
                    {a.progress}/{a.goal}
                  </span>
                ) : null}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
