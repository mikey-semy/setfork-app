import * as React from 'react'
import { cn } from '@/shared/lib/cn'
import { CONTROL_TEXT, FIELD_BOX, FIELD_TEXT_MOBILE } from './control'

// Единая textarea. Для markdown-полей с тулбаром — MarkdownEditor (поверх этой базы стилей).
// variant='bare' — без рамки, для вложения в готовый контейнер (например, AI-area).
// Кегль и рамка — из общей шкалы control.ts (высота у textarea своя — многострочная).

// React 19: ref — обычный проп (ComponentProps его включает), forwardRef не нужен.
export interface TextareaProps extends React.ComponentProps<'textarea'> {
  variant?: 'box' | 'bare'
}

export function Textarea({ variant = 'box', className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        'w-full',
        CONTROL_TEXT.md,
        FIELD_TEXT_MOBILE,
        variant === 'box'
          ? cn(FIELD_BOX, 'px-3 py-2')
          : 'resize-none bg-transparent text-ink outline-hidden placeholder:text-muted disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
