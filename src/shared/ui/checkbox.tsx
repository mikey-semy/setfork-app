'use client'

import * as React from 'react'
import { cn } from '@/shared/lib/cn'

// Единый чекбокс (нативный input под капотом — доступность/формы бесплатно,
// accent-цвет из токена). Для «переключателей» — shared/ui/switch.

// React 19: ref — обычный проп (ComponentProps его включает), forwardRef не нужен.
export type CheckboxProps = React.ComponentProps<'input'>

export function Checkbox({ className, ...props }: CheckboxProps) {
  return <input type="checkbox" className={cn('accent-accent', className)} {...props} />
}

/** Строка «чекбокс + заголовок + подпись» — форма чекбокс-списков (фильтры, настройки). */
/**
 * Переключатель ОДНОГО ИЗ НЕСКОЛЬКИХ. Тот же примитив, что чекбокс, только тип другой —
 * и заведён по той же причине: без него радиокнопки красились кто во что. Замер
 * 26.08.2026 нашёл `accent-current` в списке причин жалобы (то есть цвет наследовался
 * от текста и менялся вместе с ним) при `accent-accent` у соседних чекбоксов.
 *
 * ⚠️ Радио, СПРЯТАННОЕ `sr-only` под своей карточкой-подписью, примитивом не заменяют:
 * это признанный приём (нативная семантика и клавиатура остаются, вид рисует label),
 * и вмешиваться в него нечем.
 */
export function Radio({ className, ...props }: React.ComponentProps<'input'>) {
  return <input type="radio" className={cn('accent-accent', className)} {...props} />
}

export function CheckboxRow({
  checked,
  onChange,
  title,
  sub,
  icon,
  className,
}: {
  checked: boolean
  onChange: () => void
  title: React.ReactNode
  sub?: React.ReactNode
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-surface-2', className)}>
      <Checkbox checked={checked} onChange={onChange} className="mt-0.5" />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-body font-semibold text-ink">
          {icon} {title}
        </span>
        {sub && <span className="block text-caption leading-snug text-muted">{sub}</span>}
      </span>
    </label>
  )
}
