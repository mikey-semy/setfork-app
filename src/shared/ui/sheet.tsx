'use client'

import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { iconSizeFor, LAYER } from './control'
import { IconButton } from './IconButton'

/**
 * Боковая панель (shadcn Sheet поверх Radix Dialog): выезжает с края экрана и
 * держит то, что не должно занимать место на самом экране — свойства списка,
 * фильтры, настройки.
 *
 * От модалки отличается тем, что не перекрывает работу целиком: содержимое
 * остаётся видимым сбоку, и закрытие возвращает ровно то же место. На узком экране
 * панель занимает почти всю ширину — иначе колонка полей становится нечитаемой.
 *
 * Доступность даёт Radix: фокус запирается внутри, Esc закрывает, фон помечен
 * inert. Заголовок обязателен (`SheetTitle`) — без него диалог безымянный для
 * диктора.
 */
const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger
const SheetClose = SheetPrimitive.Close

function SheetContent({
  className,
  children,
  side = 'right',
  closeLabel,
  /**
   * Портал выносит панель в конец body — и поля внутри перестают принадлежать форме,
   * из которой её открыли. Для панели со СВОЙСТВАМИ формы его отключают: содержимое
   * остаётся потомком form, и server-форма читает поля сама, без скрытых двойников.
   *
   * Вместе с порталом отключается и размонтирование: закрытая панель остаётся в
   * DOM, только спрятанной. Иначе поля исчезают вместе с ней — человек вводит
   * описание и теги, закрывает панель, сохраняет, и на сервер уходит ПУСТО
   * (на правке это стирает уже существующие значения). Замер 08.08.2026: после
   * закрытия `input[name=desc]` в документе не было вовсе.
   */
  portal = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: 'right' | 'left'; closeLabel: string; portal?: boolean }) {
  const Portal = portal ? SheetPrimitive.Portal : React.Fragment
  // Панель-часть-формы держим смонтированной; обычная панель (в портале) живёт по
  // умолчанию Radix — монтируется на открытие и не занимает DOM зря.
  const keep = portal ? undefined : true
  return (
    <Portal {...(keep ? { forceMount: true } : {})}>
      <SheetPrimitive.Overlay
        forceMount={keep}
        className={cn('fixed inset-0 bg-black/50 backdrop-blur-[1px] data-[state=closed]:hidden', LAYER.overlay)}
      />
      <SheetPrimitive.Content
        forceMount={keep}
        className={cn(
          'fixed inset-y-0 flex w-full flex-col gap-4 overflow-y-auto border-border bg-surface p-4 shadow-card sm:max-w-md',
          side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
          // Закрытая панель обязана быть невидимой и недосягаемой для указателя и
          // клавиатуры — но ОСТАТЬСЯ в документе, иначе её поля не уедут с формой.
          'data-[state=closed]:pointer-events-none data-[state=closed]:invisible',
          LAYER.modal,
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close asChild className="absolute top-3 right-3">
          <IconButton variant="ghost" label={closeLabel}>
            <X size={iconSizeFor()} />
          </IconButton>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </Portal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 pr-10', className)} {...props} />
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title className={cn('text-[1rem] font-semibold text-ink', className)} {...props} />
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description className={cn('text-[0.78125rem] text-ink-2', className)} {...props} />
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger }
