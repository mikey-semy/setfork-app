import * as React from 'react'
import { cn } from '@/shared/lib/cn'
import { CONTROL_H, CONTROL_TEXT, type ControlSize } from './control'

// Единая кнопка приложения. Варианты покрывают весь используемый спектр:
//   primary — главное действие (bg-primary)
//   outline — вторичное (рамка border, hover усиливает рамку)
//   ghost   — «тихая» (без рамки, hover-подложка)
//   danger  — деструктивная (текст/hover в danger)
// Размеры — из общей шкалы control.ts: кнопка в одном ряду с Input/Select
// обязана совпадать с ними по высоте и кеглю. Эталон — /admin/ui-kit.

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'dangerSolid'
export type ButtonSize = ControlSize

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg hover:opacity-90',
  outline: 'border border-border bg-surface-2 text-ink hover:border-border-strong',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'text-muted hover:bg-danger/10 hover:text-danger', // «тихая» (иконка-корзинка)
  dangerSolid: 'bg-danger text-white hover:opacity-90', // залитая деструктивная (удалить аккаунт/список)
}

// px у кнопок шире полей того же размера — тексту в кнопке нужен воздух.
const SIZES: Record<ButtonSize, string> = {
  xs: 'px-2 gap-1',
  sm: 'px-2.5 gap-1.5',
  md: 'px-3.5 gap-1.5',
}

// React 19: ref — обычный проп (ComponentProps его включает), forwardRef не нужен.
export interface ButtonProps extends React.ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant = 'outline', size = 'sm', className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-semibold outline-hidden transition-colors focus-visible:ring-1 focus-visible:ring-border-strong disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        CONTROL_H[size],
        CONTROL_TEXT[size],
        SIZES[size],
        className,
      )}
      {...props}
    />
  )
}
