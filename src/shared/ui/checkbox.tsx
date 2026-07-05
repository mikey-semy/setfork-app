'use client'

import * as React from 'react'
import { cn } from '@/shared/lib/cn'

// Единый чекбокс (нативный input под капотом — доступность/формы бесплатно,
// accent-цвет из токена). Для «переключателей» — shared/ui/switch.

export type CheckboxProps = React.InputHTMLAttributes<HTMLInputElement>

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, ...props },
  ref,
) {
  return <input ref={ref} type="checkbox" className={cn('accent-[var(--accent)]', className)} {...props} />
})

/** Строка «чекбокс + заголовок + подпись» — форма чекбокс-списков (фильтры, настройки). */
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
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          {icon} {title}
        </span>
        {sub && <span className="block text-[11.5px] leading-snug text-muted">{sub}</span>}
      </span>
    </label>
  )
}
