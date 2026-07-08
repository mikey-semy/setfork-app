import * as React from 'react'
import { cn } from '@/shared/lib/cn'

// Единая textarea. Для markdown-полей с тулбаром — MarkdownEditor (поверх этой базы стилей).
// variant='bare' — без рамки, для вложения в готовый контейнер (например, AI-area).

// React 19: ref — обычный проп (ComponentProps его включает), forwardRef не нужен.
export interface TextareaProps extends React.ComponentProps<'textarea'> {
  variant?: 'box' | 'bare'
}

export function Textarea({ variant = 'box', className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        'w-full text-[13.5px] text-ink outline-none placeholder:text-muted disabled:opacity-50',
        variant === 'box'
          ? 'rounded-md border border-border bg-surface-2 px-2.5 py-2 focus:border-border-strong'
          : 'resize-none bg-transparent',
        className,
      )}
      {...props}
    />
  )
}
