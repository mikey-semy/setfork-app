import { cn } from '@/shared/lib/cn'

/**
 * Полоска-доля: сколько занимает часть от целого.
 *
 * Один рецепт на приложение — до этого он трижды переписывался руками (остаток
 * кредитов, загрузка очереди, вклад по спискам) и каждый раз со своей высотой,
 * скруглением и фоном. Значение приходит долей 0…1, а не процентами: считать
 * проценты внутри проще, чем ловить, где их посчитали дважды.
 *
 * Чисто визуальный элемент: рядом всегда стоит само число, поэтому для
 * скринридера полоска скрыта — иначе он читает одно и то же дважды.
 */
const TONE = {
  accent: 'bg-accent',
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
} as const

export type MeterTone = keyof typeof TONE

export function Meter({
  value,
  tone = 'accent',
  className,
}: {
  /** Доля 0…1; выходящее за границы подрезается. */
  value: number
  tone?: MeterTone
  className?: string
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <span aria-hidden className={cn('block h-1.5 overflow-hidden rounded-full bg-surface-2', className)}>
      <span className={cn('block h-full rounded-full transition-[width] duration-(--dur-base)', TONE[tone])} style={{ width: `${pct}%` }} />
    </span>
  )
}
