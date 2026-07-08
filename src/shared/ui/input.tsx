import * as React from 'react'
import { cn } from '@/shared/lib/cn'

// Единый текстовый инпут (поисковые поля — отдельный SearchField).
// Размеры согласованы с Button/SearchField: xs — поповеры, sm — панели, md — формы.

export type InputSize = 'xs' | 'sm' | 'md'

const SIZES: Record<InputSize, string> = {
  xs: 'px-2 py-1 text-[12.5px]',
  sm: 'px-2.5 py-1.5 text-[13px]',
  md: 'px-2.5 py-2 text-[13.5px]',
}

// React 19: ref — обычный проп (ComponentProps его включает), forwardRef не нужен.
export interface InputProps extends Omit<React.ComponentProps<'input'>, 'size'> {
  size?: InputSize
}

export function Input({ size = 'md', className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'w-full rounded-md border border-border bg-surface-2 text-ink outline-hidden placeholder:text-muted focus:border-border-strong disabled:opacity-50',
        SIZES[size],
        className,
      )}
      {...props}
    />
  )
}
