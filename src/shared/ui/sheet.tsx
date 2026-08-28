'use client'

import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { iconSizeFor, LAYER } from './control'
import { IconButton } from './IconButton'
import { BACKDROP_DIM } from './Backdrop'

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
  // Панель-часть-формы держим смонтированной; обычная панель (в портале) живёт по
  // умолчанию Radix — монтируется на открытие и не занимает DOM зря.
  const keep = portal ? undefined : true
  // Обёртка: настоящий портал — только когда он нужен. React.Fragment пропов не
  // принимает вовсе (forceMount на нём — предупреждение в консоли), поэтому
  // ветвление здесь, а не в пропах общей переменной.
  const wrap = (children: React.ReactNode) =>
    portal ? <SheetPrimitive.Portal>{children}</SheetPrimitive.Portal> : <>{children}</>
  return wrap(
    <>
      <SheetPrimitive.Overlay
        forceMount={keep}
        className={cn('fixed inset-0 backdrop-blur-[1px] data-[state=closed]:hidden', BACKDROP_DIM, LAYER.overlay)}
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
        {/*
         * ⚠️ Позиционирование на ОБЁРТКЕ, а не на самой кнопке.
         *
         * Было `<SheetPrimitive.Close asChild className="absolute top-3 right-3">`. При
         * `asChild` Radix склеивает классы СТРОКОЙ: свои первыми, детские вторыми, — и
         * tailwind-merge тут не участвует. А `buttonClass` подмешивает тач-зону `TOUCH_HIT`,
         * в которой есть `pointer-coarse:relative`. На грубом указателе этот `relative`
         * оказывался ПОЗЖЕ `absolute` и побеждал: кнопка выпадала из абсолютного
         * позиционирования в обычный поток — то есть уезжала в самый низ панели, под все
         * поля. Владелец так это и увидел: «крестик закрытия вообще внизу под всеми
         * элементами». На мыши дефект не проявлялся вовсе.
         *
         * Обёртка разводит две роли: она позиционирует, кнопка остаётся кнопкой со своей
         * тач-зоной. Ни один класс другого больше не перебивает.
         */}
        <div className="absolute right-3 top-3">
          <SheetPrimitive.Close asChild>
            <IconButton variant="ghost" label={closeLabel}>
              <X size={iconSizeFor()} />
            </IconButton>
          </SheetPrimitive.Close>
        </div>
      </SheetPrimitive.Content>
    </>,
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 pr-10', className)} {...props} />
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title className={cn('text-title font-semibold text-ink', className)} {...props} />
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description className={cn('text-body-sm text-ink-2', className)} {...props} />
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger }
