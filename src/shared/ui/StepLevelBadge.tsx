import { AlertTriangle } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import type { StepLevel } from '@/shared/db'
import { stepDanger } from '@/core/domain/destructive-command'

// Бейдж уровня шага. Для 'required' (норма) ничего не рисуем.
export function StepLevelBadge({ level, lang }: { level: StepLevel; lang: Lang }) {
  if (level === 'required') return null
  const recommended = level === 'recommended'
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-caption font-medium ${
        recommended ? 'border-warn text-warn' : 'border-border text-muted'
      }`}
    >
      {t(recommended ? 'levelRecommended' : 'levelOptional', lang)}
    </span>
  )
}

/**
 * Бейдж «разрушительный пункт» — рядом с бейджем уровня, тем же размером.
 *
 * Считается ТОЙ ЖЕ функцией, что решает судьбу пункта в собранном скрипте
 * (stepDanger): иначе на странице пункт выглядел бы обычным, а в скрипте
 * приезжал закомментированным — и наоборот.
 */
export function StepDangerBadge({ step, lang }: { step: { danger?: boolean | null; command?: string | null }; lang: Lang }) {
  if (!step.command?.trim() || !stepDanger(step)) return null
  // На узком экране — только знак: подпись «Разрушительный» рядом с уровнем шага
  // съедала бы строку заголовка целиком. Смысл при этом не теряется: значение
  // висит в title и в aria-label, а не только в тексте.
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-danger px-1.5 py-0.5 text-caption font-medium text-danger"
      title={t('dangerBadgeTitle', lang)}
      aria-label={t('dangerBadge', lang)}
    >
      <AlertTriangle size={11} aria-hidden />
      <span className="hidden sm:inline">{t('dangerBadge', lang)}</span>
    </span>
  )
}
