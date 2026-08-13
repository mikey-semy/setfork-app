'use client'

import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { CONTROL_H, CONTROL_PX, CONTROL_TEXT, FIELD_BOX, ICON_SIZE, type ControlSize } from './control'

const Select = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

// React 19: ref — обычный проп (ComponentProps его включает), forwardRef не нужен.
// Размеры — из общей шкалы control.ts (высота ряда = Input/Button того же size).
function SelectTrigger({
  size = 'md',
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & { size?: ControlSize }) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
      // Высота у поля ФИКСИРОВАННАЯ (шкала), поэтому длинная подпись обязана
      // обрезаться, а не переноситься: без этого выбранный вариант вроде
      // «Observe — decide and log, do not publish» разъезжался на две строки и
      // вылезал за рамку. Так же поступает shadcn (`whitespace-nowrap` на
      // триггере + обрезка значения) — полный текст виден в раскрытом списке.
      'flex w-full items-center justify-between gap-2 whitespace-nowrap data-placeholder:text-muted [&>span]:min-w-0 [&>span]:truncate',
      FIELD_BOX,
      CONTROL_H[size],
      CONTROL_PX[size],
      CONTROL_TEXT[size],
      className,
    )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        {/* shrink-0: каретку нельзя сжимать — иначе длинное значение её съедает. */}
        <ChevronDown size={ICON_SIZE[size]} className="shrink-0 text-muted" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({ className, children, position = 'popper', ...props }: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      className={cn(
        'sf-pop-in relative z-50 max-h-[20rem] min-w-40 overflow-hidden rounded-md border border-border bg-surface text-ink shadow-card',
        position === 'popper' && 'data-[side=bottom]:translate-y-1',
        className,
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-muted">
        <ChevronUp size={14} />
      </SelectPrimitive.ScrollUpButton>
      <SelectPrimitive.Viewport
        className={cn('p-1', position === 'popper' && 'w-full min-w-(--radix-select-trigger-width)')}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-muted">
        <ChevronDown size={14} />
      </SelectPrimitive.ScrollDownButton>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
  )
}

function SelectItem({
  className,
  children,
  trailing,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & { trailing?: React.ReactNode }) {
  return (
  <SelectPrimitive.Item
    className={cn(
      'relative flex w-full cursor-pointer select-none items-center rounded-sm py-2 pl-8 pr-3 text-[0.8125rem] text-ink outline-hidden data-highlighted:bg-(--accent-soft) data-highlighted:text-accent data-disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute left-2.5 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check size={14} />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    {/* Правая колонка (напр. цена) — прижата к правому краю, не уезжает в trigger. */}
    {trailing != null && <span className="ml-auto shrink-0 pl-4">{trailing}</span>}
  </SelectPrimitive.Item>
  )
}

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectItem }
