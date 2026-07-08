'use client'

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

// Единый тултип (Radix) вместо браузерного title=. Стиль — из токенов.
// Триггер оборачивает переданный children через asChild (кнопку/иконку).
export function Tooltip({
  label,
  children,
  side = 'top',
  delay = 250,
}: {
  label: React.ReactNode
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
}) {
  if (!label) return <>{children}</>
  return (
    <TooltipPrimitive.Provider delayDuration={delay} skipDelayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className="z-200 max-w-[240px] rounded-md border border-border bg-surface px-2 py-1 text-[11.5px] leading-snug text-ink shadow-card"
          >
            {label}
            <TooltipPrimitive.Arrow className="fill-(--surface)" width={10} height={5} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
