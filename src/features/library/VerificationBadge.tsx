import { Gem, Hammer, FileCheck2, Bot, Mountain } from 'lucide-react'
import { t, type Lang } from '@/shared/i18n'
import { Tooltip } from '@/shared/ui/Tooltip'

/**
 * УРОВЕНЬ ПРОВЕРКИ ВЕРСИИ — метка с датой (решение 0018 от 04.08.2026).
 *
 * Бинарное «проверено» нежизнеспособно: проверить «в деле» список про развёртывание —
 * значит реально развернуть. Поэтому градация от «никто не проверял» до «выполнено
 * целиком», и она относится к ВЕРСИИ: правка сбрасывает уровень.
 *
 * ⚠️ ДАТА ПОКАЗЫВАЕТСЯ ВСЕГДА, когда она есть. Без неё метка врёт тем сильнее, чем
 * старше список: «выполнено целиком» полугодовой давности про Caddy 2.8 сегодня может
 * не работать вовсе. Это записано прямо в решении, и это главное отличие от значка
 * «проверен», который отсюда убран (0006).
 *
 * «Породу» НЕ показываем вовсе: отсутствие метки и есть «никто не проверял», а отдельная
 * метка про это была бы шумом на каждой карточке корпуса.
 */
export type VerificationLevel = 'rock' | 'doc_checked' | 'machine_run' | 'cut' | 'crystal'

const LOOK = {
  doc_checked: { icon: FileCheck2, tone: 'text-muted', key: 'verify.docChecked' },
  machine_run: { icon: Bot, tone: 'text-ink-2', key: 'verify.machineRun' },
  cut: { icon: Hammer, tone: 'text-accent', key: 'verify.cut' },
  crystal: { icon: Gem, tone: 'text-accent', key: 'verify.crystal' },
} as const satisfies Record<Exclude<VerificationLevel, 'rock'>, { icon: typeof Gem; tone: string; key: string }>

/** Порода в интерфейсе не рисуется — см. шапку. Иконка объявлена для полноты набора. */
export const ROCK_ICON = Mountain

export function VerificationBadge({
  level,
  verifiedAt,
  lang,
  className,
}: {
  level: string | null | undefined
  verifiedAt: Date | string | null | undefined
  lang: Lang
  className?: string
}) {
  if (!level || level === 'rock' || !(level in LOOK)) return null
  const look = LOOK[level as keyof typeof LOOK]
  const Icon = look.icon
  const label = t(look.key as Parameters<typeof t>[0], lang)
  // Дата — короткая и локальная: в метке важен ПОРЯДОК давности, а не минуты.
  const when = verifiedAt ? new Date(verifiedAt).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB') : null

  return (
    <Tooltip label={when ? `${label} · ${when}` : label}>
      <span className={`inline-flex items-center gap-1.5 ${look.tone} ${className ?? ''}`}>
        <Icon size={14} />
        <span className="whitespace-nowrap">{when ? `${label} · ${when}` : label}</span>
      </span>
    </Tooltip>
  )
}
