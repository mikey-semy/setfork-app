'use client'

import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/shared/lib/cn'

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-[22px] w-[40px] shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors outline-none',
      'focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:bg-[var(--ok)] data-[state=unchecked]:bg-[var(--border-strong)]',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform',
        'data-[state=checked]:translate-x-[19px] data-[state=unchecked]:translate-x-[1px]',
      )}
    />
  </SwitchPrimitive.Root>
))
Switch.displayName = SwitchPrimitive.Root.displayName

export { Switch }
