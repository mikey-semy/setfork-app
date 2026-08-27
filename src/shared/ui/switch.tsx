'use client'

import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/shared/lib/cn'
import { TOUCH_HIT_ROW } from './control'

// React 19: ref — обычный проп (ComponentProps его включает), forwardRef не нужен.
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
      'peer inline-flex h-5.5 w-10 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors outline-hidden',
      'focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50',
      // Пилюля 40×22 — вид, менять его нельзя; пальцу же нужна цель 44. Растёт
      // ОБЛАСТЬ нажатия, а не размер: ровно так это решают Apple HIG и Material.
      // Вариант ROW: переключатели стоят в столбик, и зоне нужно СВОЁ место —
      // иначе она накрывает соседнюю настройку.
      TOUCH_HIT_ROW,
      'data-[state=checked]:bg-ok data-[state=unchecked]:bg-border-strong',
      className,
    )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block h-4.5 w-4.5 rounded-full bg-white shadow-xs transition-transform',
          'data-[state=checked]:translate-x-[1.1875rem] data-[state=unchecked]:translate-x-px',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
