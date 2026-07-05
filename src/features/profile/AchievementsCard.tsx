import { Award } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import type { Lang } from '@/shared/i18n'
import { computeAchievements, type AchievementInput } from './achievements'
import { ACH_META } from './achievement-meta'
import type { AchDisplayMap } from './achievement-config'

/** Достижения на профиле (левый сайдбар): заработанные ярко, прочие приглушённо
 *  с прогрессом. Админ может выключить достижение или задать свою картинку. */
export function AchievementsCard({ input, lang, config }: { input: AchievementInput; lang: Lang; config?: AchDisplayMap }) {
  const ru = lang === 'ru'
  // Выключенные админом — не показываем вовсе (даже заработанные).
  const all = computeAchievements(input).filter((a) => config?.[a.key]?.enabled !== false)
  const earned = all.filter((a) => a.earned)
  if (earned.length === 0) return null // пустому профилю не показываем

  return (
    <div className="mt-6 rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <Award size={14} className="text-muted" /> {ru ? 'Достижения' : 'Achievements'}
        <Badge variant="soft" className="ml-1">
          {earned.length}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {all.map((a) => {
          const m = ACH_META[a.key]
          const Icon = m.icon
          const label = ru ? m.ru : m.en
          const img = config?.[a.key]?.imageUrl
          return (
            <div
              key={a.key}
              title={a.earned ? label : `${label} — ${a.progress}/${a.goal}`}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-2 ${
                a.earned ? 'border-border bg-surface-2' : 'border-dashed border-border opacity-55'
              }`}
            >
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img} alt="" className={`h-4 w-4 shrink-0 rounded-sm object-cover ${a.earned ? '' : 'grayscale'}`} />
              ) : (
                <Icon size={16} className={`shrink-0 ${a.earned ? m.color : 'text-muted'}`} />
              )}
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
