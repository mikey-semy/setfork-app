import { Award } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { t, type Lang } from '@/shared/i18n'
import { computeAchievements, type AchievementInput } from './achievements'
import { ACH_META } from './achievement-meta'
import type { AchDisplayMap } from './achievement-config'
import { AchievementsGrid, type AchTileData } from './AchievementsGrid'
import { cardClass } from '@/shared/ui/card-style'

/** Достижения на профиле (левый сайдбар): квадратные плитки-картинки без подписей;
 *  клик открывает модалку с историей. Картинка — ОБЯЗАТЕЛЬНЫЙ атрибут: показываем
 *  только заработанные ачивки, для которых админ задал картинку. Нет ни одной такой
 *  (как по умолчанию) — карточка не рендерится вовсе (функционал скрыт). */
export function AchievementsCard({ input, lang, config }: { input: AchievementInput; lang: Lang; config?: AchDisplayMap }) {
  const shown = computeAchievements(input)
    .filter((a) => config?.[a.key]?.enabled !== false && a.earned && config?.[a.key]?.imageUrl)
  if (shown.length === 0) return null

  const items: AchTileData[] = shown.map((a) => {
    const m = ACH_META[a.key]
    return {
      key: a.key,
      label: t(m.label, lang),
      desc: t(m.desc, lang),
      imageUrl: config![a.key].imageUrl,
      tier: a.tier,
      value: a.value,
      tiers: a.tiers,
      unit: t(m.unit, lang),
    }
  })

  return (
    <div className={cardClass({ className: 'mt-6' })}>
      <div className="mb-3 flex items-center gap-1.5 text-[0.8125rem] font-semibold text-ink">
        <Award size={14} className="text-muted" /> {t('ach.title', lang)}
        <Badge variant="soft" className="ml-1">
          {items.length}
        </Badge>
      </div>
      <AchievementsGrid items={items} lang={lang} />
    </div>
  )
}
