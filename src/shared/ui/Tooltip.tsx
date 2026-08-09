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
//
// ВНИМАНИЕ к порядку с ДРУГИМИ триггерами (Sheet, DropdownMenu, Popover): этот
// компонент НЕ пробрасывает полученные снаружи пропы в children. Поэтому Tooltip
// ставится СНАРУЖИ, а триггер — внутри:
//     <Tooltip label="…"><SheetTrigger asChild><IconButton …/></SheetTrigger></Tooltip>
// Обратный порядок молча ломает кнопку: onClick и aria-* от триггера уходят в
// Tooltip и до неё не доходят (09.08.2026 так перестала открываться панель свойств).
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
          className="sf-pop-in z-60 max-w-[15rem] rounded-md border border-border bg-surface px-2 py-1 text-[0.6875rem] leading-snug text-ink shadow-card"
        >
          {label}
          <TooltipPrimitive.Arrow className="fill-(--surface)" width={10} height={5} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
