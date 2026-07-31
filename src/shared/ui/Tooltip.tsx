'use client'

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

// Единый провайдер тултипов — ОДИН на приложение (монтируется в layout). Раньше
// каждый <Tooltip> тянул свой Provider; теперь все делят один (общие задержки,
// корректный skip между соседними тултипами).
export function TooltipProvider({ children, delay = 250 }: { children: React.ReactNode; delay?: number }) {
  return (
    <TooltipPrimitive.Provider delayDuration={delay} skipDelayDuration={300}>
      {children}
    </TooltipPrimitive.Provider>
  )
}

// Тултип (Radix / shadcn-стиль) вместо браузерного title=. Триггер оборачивает
// переданный children через asChild (кнопку/иконку/ссылку). Требует <TooltipProvider>
// в предках (есть в layout). Пустой label → просто children без тултипа.
export function Tooltip({
  label,
  children,
  side = 'top',
  delay,
}: {
  label: React.ReactNode
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
}) {
  if (!label) return <>{children}</>
  return (
    <TooltipPrimitive.Root delayDuration={delay}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-60 max-w-[240px] rounded-md border border-border bg-surface px-2 py-1 text-[11px] leading-snug text-ink shadow-card"
        >
          {label}
          <TooltipPrimitive.Arrow className="fill-(--surface)" width={10} height={5} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
