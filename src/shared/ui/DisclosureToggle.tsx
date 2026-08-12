'use client'

import { ChevronRight } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { TOUCH_MIN_H } from './control'

/**
 * Строка-раскрывашка: вся она и есть кнопка, стрелка поворачивается на 90°.
 *
 * Рецепт уже был написан руками в истории версий и повторялся бы на каждом
 * уровне ленты активности — а это ровно тот случай, когда расходятся мелочи:
 * поворот стрелки, `aria-expanded`, тач-высота и видимый фокус. Теперь он один.
 *
 * Кнопкой делается СТРОКА целиком, а не стрелка: на телефоне целиться в иконку
 * 13px нечем, а строка даёт цель во всю ширину.
 */
export function DisclosureToggle({
  open,
  onToggle,
  label,
  icon = 13,
  className,
  iconClassName,
  children,
}: {
  open: boolean
  onToggle: () => void
  /** Что раскрываем — подпись для скринридера (у стрелки текста нет). */
  label: string
  /** Размер стрелки, px. */
  icon?: number
  className?: string
  iconClassName?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={label}
      className={cn('flex w-full min-w-0 items-center gap-1.5 rounded-md text-left outline-hidden focus-visible:ring-1 focus-visible:ring-accent', TOUCH_MIN_H, className)}
    >
      <ChevronRight
        size={icon}
        className={cn('shrink-0 text-muted transition-transform duration-(--dur-base)', open && 'rotate-90', iconClassName)}
      />
      {children}
    </button>
  )
}
