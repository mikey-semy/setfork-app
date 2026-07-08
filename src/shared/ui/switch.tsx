'use client'

import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/shared/lib/cn'

// React 19: ref — обычный проп (ComponentProps его включает), forwardRef не нужен.
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
      'peer inline-flex h-[22px] w-[40px] shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors outline-hidden',
      'focus-visible:ring-2 focus-visible:ring-(--accent) disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-ok data-[state=unchecked]:bg-(--border-strong)',
      className,
    )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block h-[18px] w-[18px] rounded-full bg-white shadow-xs transition-transform',
          'data-[state=checked]:translate-x-[19px] data-[state=unchecked]:translate-x-px',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
