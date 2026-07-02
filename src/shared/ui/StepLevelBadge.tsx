import { t, type Lang } from '@/shared/i18n'
import type { StepLevel } from '@/shared/db'

// Бейдж уровня шага. Для 'required' (норма) ничего не рисуем.
export function StepLevelBadge({ level, lang }: { level: StepLevel; lang: Lang }) {
  if (level === 'required') return null
  const recommended = level === 'recommended'
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10.5px] font-medium ${
        recommended ? 'border-warn text-warn' : 'border-border text-muted'
      }`}
    >
      {t(recommended ? 'levelRecommended' : 'levelOptional', lang)}
    </span>
  )
}
