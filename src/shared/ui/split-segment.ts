import { cn } from '@/shared/lib/cn'

/**
 * Тон и классы сегментов сплит-кнопки — НЕ компоненты, поэтому живут отдельным модулем:
 * файл с компонентом должен экспортировать только компоненты, иначе Fast Refresh теряет
 * состояние и перезагружает страницу целиком (react-doctor: only-export-components).
 */
export type SplitTone = 'neutral' | 'accent' | 'warn'

export const TONE_BORDER: Record<SplitTone, string> = {
  neutral: 'border-border hover:border-border-strong',
  accent: 'border-accent',
  warn: 'border-warn',
}

export const TONE_DIVIDER: Record<SplitTone, string> = {
  neutral: 'bg-border',
  accent: 'bg-accent/40',
  warn: 'bg-warn/40',
}

/** Общий класс сегмента: высота группы, ровные поля, подложка по наведению. */
export function splitSegment(opts: { interactive?: boolean; muted?: boolean; className?: string } = {}) {
  const { interactive = true, muted = false, className } = opts
  return cn(
    'inline-flex h-full items-center gap-2 px-3 text-[13px] font-semibold transition-colors',
    muted && 'px-2.5 font-mono text-[12px] font-normal text-muted',
    interactive && 'hover:bg-surface-2 hover:text-ink',
    className,
  )
}

