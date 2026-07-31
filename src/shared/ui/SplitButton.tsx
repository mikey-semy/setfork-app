import * as React from 'react'
import { cn } from '@/shared/lib/cn'

/**
 * СПЛИТ-КНОПКА — один примитив на все составные кнопки шапки списка (Следить, Звезда,
 * Форк). Анатомия у всех одна: [действие] │ [счётчик] │ [каретка], рамка одна на группу,
 * между сегментами — разделитель, высота 36px.
 *
 * Зачем примитив, а не «поправить в каждой»: раньше каждая кнопка собиралась вручную, и
 * они разъезжались по мелочам — у звезды каретка была без разделителя и без подложки, у
 * «Следить» разделитель не менял цвет вместе с состоянием, размеры кареток отличались на
 * пиксель. Владелец справедливо сказал, что это читается как две разные кнопки. Пока
 * анатомия живёт в трёх местах, она будет расходиться снова; здесь — одно место.
 *
 * Цвет состояния задаёт `tone`: он красит рамку И разделители, поэтому подсвеченная
 * кнопка выглядит цельной, а не «крашеной слева».
 */
export type SplitTone = 'neutral' | 'accent' | 'warn'

const TONE_BORDER: Record<SplitTone, string> = {
  neutral: 'border-border hover:border-border-strong',
  accent: 'border-accent',
  warn: 'border-warn',
}

const TONE_DIVIDER: Record<SplitTone, string> = {
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

export function SplitButton({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: SplitTone
  /** Сегменты по порядку; разделители расставляются сами. `null`/`false` пропускаются. */
  children: React.ReactNode
  className?: string
}) {
  const parts = React.Children.toArray(children).filter(Boolean)
  return (
    <span className={cn('inline-flex h-9 items-stretch overflow-hidden rounded-md border transition-colors', TONE_BORDER[tone], className)}>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {/* Разделитель — своей линией, а не border у половинки: внешняя рамка остаётся
              цельной и не рвётся на стыке. */}
          {i > 0 && <span aria-hidden className={cn('w-px shrink-0', TONE_DIVIDER[tone])} />}
          {part}
        </React.Fragment>
      ))}
    </span>
  )
}
