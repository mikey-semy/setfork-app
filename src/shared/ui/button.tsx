import * as React from 'react'
import { cn } from '@/shared/lib/cn'

// Единая кнопка приложения. Варианты покрывают весь используемый спектр:
//   primary — главное действие (bg-primary)
//   outline — вторичное (рамка border, hover усиливает рамку)
//   ghost   — «тихая» (без рамки, hover-подложка)
//   danger  — деструктивная (текст/hover в danger)
// Размеры: xs (плотные тулбары/поповеры), sm (обычные панели), md (формы).

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'dangerSolid'
export type ButtonSize = 'xs' | 'sm' | 'md'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg hover:opacity-90',
  outline: 'border border-border bg-surface-2 text-ink hover:border-border-strong',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'text-muted hover:bg-danger/10 hover:text-danger', // «тихая» (иконка-корзинка)
  dangerSolid: 'bg-danger text-white hover:opacity-90', // залитая деструктивная (удалить аккаунт/список)
}

const SIZES: Record<ButtonSize, string> = {
  xs: 'px-2 py-1 text-[12px] gap-1',
  sm: 'px-2.5 py-1.5 text-[12.5px] gap-1.5',
  md: 'px-3.5 py-2 text-[13px] gap-1.5',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'outline', size = 'sm', className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-semibold outline-none transition-colors focus-visible:ring-1 focus-visible:ring-border-strong disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  )
})
