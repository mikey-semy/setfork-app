'use client'

import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/shared/lib/cn'

// Якорный поповер (Radix): портал в body (не режется overflow/z-index родителя) И
// привязан к триггеру (не «по центру экрана», как модалка). Для пикеров, что должны
// висеть рядом с кнопкой — эмодзи и т.п. Центр-модалка — это OverlayPanel.
export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverAnchor = PopoverPrimitive.Anchor

export function PopoverContent({
  className,
  align = 'center',
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn('z-100 rounded-lg border border-border bg-surface shadow-card outline-hidden', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
