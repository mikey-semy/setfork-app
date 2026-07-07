import { Award } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import type { Lang } from '@/shared/i18n'
import { computeAchievements, type AchievementInput } from './achievements'
import { ACH_META } from './achievement-meta'
import type { AchDisplayMap } from './achievement-config'
import { AchievementsGrid, type AchTileData } from './AchievementsGrid'

/** Достижения на профиле (левый сайдбар): квадратные плитки-картинки без подписей;
 *  клик открывает модалку с историей. Картинка — ОБЯЗАТЕЛЬНЫЙ атрибут: показываем
 *  только заработанные ачивки, для которых админ задал картинку. Нет ни одной такой
 *  (как по умолчанию) — карточка не рендерится вовсе (функционал скрыт). */
export function AchievementsCard({ input, lang, config }: { input: AchievementInput; lang: Lang; config?: AchDisplayMap }) {
  const ru = lang === 'ru'
  const shown = computeAchievements(input)
    .filter((a) => config?.[a.key]?.enabled !== false && a.earned && config?.[a.key]?.imageUrl)
  if (shown.length === 0) return null

  const items: AchTileData[] = shown.map((a) => {
    const m = ACH_META[a.key]
    return {
      key: a.key,
      label: ru ? m.ru : m.en,
      desc: ru ? m.descRu : m.descEn,
      imageUrl: config![a.key].imageUrl,
      tier: a.tier,
      value: a.value,
      tiers: a.tiers,
      unit: ru ? m.unitRu : m.unitEn,
    }
  })

  return (
    <div className="mt-6 rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <Award size={14} className="text-muted" /> {ru ? 'Достижения' : 'Achievements'}
        <Badge variant="soft" className="ml-1">
          {items.length}
        </Badge>
      </div>
      <AchievementsGrid items={items} lang={lang} />
    </div>
  )
}
