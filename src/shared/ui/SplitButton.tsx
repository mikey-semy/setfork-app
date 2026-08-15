import * as React from 'react'
import { cn } from '@/shared/lib/cn'
import { TONE_BORDER, TONE_DIVIDER, type SplitTone } from './split-segment'
import { CONTROL_H } from './control'

/**
 * СПЛИТ-КНОПКА — один примитив на все составные кнопки шапки списка (Следить, Звезда,
 * Форк). Анатомия у всех одна: [действие] │ [счётчик] │ [каретка], рамка одна на группу,
 * между сегментами — разделитель; видимая высота — md шкалы (32px) на любом
 * указателе, как у одиночных кнопок в том же ряду.
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
    <span className={cn('inline-flex items-stretch overflow-hidden rounded-md border bg-surface-2 text-ink transition-colors', CONTROL_H.md, TONE_BORDER[tone], className)}>
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
