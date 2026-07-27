import { cn } from '@/shared/lib/cn'

/**
 * Индикатор объёма изменений — ОДИН на приложение.
 *
 * До этого одни и те же счётчики были свёрстаны в четырёх местах: шапка правки,
 * разворот коммита и по шапке у каждого из двух видов диффа. Теперь цифры,
 * цвета и порядок живут здесь.
 *
 * `squares` добавляет пропорциональную полоску из квадратиков (как у GitHub):
 * доля добавленного/удалённого видна взглядом, без чтения чисел.
 */
export interface DiffCounts {
  added: number
  removed: number
  /** Изменённые и переставленные есть только у блочного диффа. */
  changed?: number
  moved?: number
}

const SQUARES = 5

export function DiffStat({
  counts,
  squares = false,
  className,
}: {
  counts: DiffCounts
  squares?: boolean
  className?: string
}) {
  const { added, removed, changed = 0, moved = 0 } = counts
  const total = added + removed + changed + moved
  if (total === 0) return null

  // Раскладка квадратиков пропорционально долям; остаток — приглушённые.
  const share = (n: number) => Math.round((n / total) * SQUARES)
  const greens = Math.min(SQUARES, share(added))
  const reds = Math.min(SQUARES - greens, share(removed))
  const yellows = Math.min(SQUARES - greens - reds, share(changed + moved))
  const rest = Math.max(0, SQUARES - greens - reds - yellows)

  return (
    <span className={cn('inline-flex items-center gap-2 font-mono text-[12.5px]', className)}>
      {added > 0 && <span className="text-ok">+{added}</span>}
      {removed > 0 && <span className="text-danger">−{removed}</span>}
      {changed > 0 && <span className="text-warn">~{changed}</span>}
      {moved > 0 && <span className="text-accent">⇅{moved}</span>}
      {squares && (
        // aria-hidden: числа рядом уже сказали всё, полоска — только визуальная опора.
        <span aria-hidden className="inline-flex items-center gap-[2px]">
          {Array.from({ length: greens }, (_, i) => (
            <span key={`a${i}`} className="size-[8px] rounded-[1px] bg-ok" />
          ))}
          {Array.from({ length: reds }, (_, i) => (
            <span key={`r${i}`} className="size-[8px] rounded-[1px] bg-danger" />
          ))}
          {Array.from({ length: yellows }, (_, i) => (
            <span key={`c${i}`} className="size-[8px] rounded-[1px] bg-warn" />
          ))}
          {Array.from({ length: rest }, (_, i) => (
            <span key={`e${i}`} className="size-[8px] rounded-[1px] bg-border" />
          ))}
        </span>
      )}
    </span>
  )
}
