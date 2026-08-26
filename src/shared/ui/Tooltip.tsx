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

/**
 * НА ПАЛЬЦЕ ПОДСКАЗКА РАБОТАЕТ ИНАЧЕ, ЧЕМ ПОД МЫШЬЮ.
 *
 * У мыши есть наведение: курсор стоит над кнопкой, подсказка висит, пока он там. У пальца
 * наведения нет вовсе — есть только «коснулся» и «отпустил». Radix в таком случае
 * показывает подсказку по касанию и почти сразу убирает её вместе с нажатием: получается
 * вспышка, которую замечаешь, но не успеваешь прочесть. То есть на телефоне подсказка не
 * помогала, а мешала — ровно так это и выглядело в работе.
 *
 * Берём поведение, которое на телефоне уже знакомо каждому: КЛАВИАТУРА. Нажал клавишу —
 * над ней всплыл символ; держишь — висит; отпустил — исчез. Здесь так же: подсказка
 * появляется по касанию, живёт, пока палец на кнопке, и уходит с отпусканием.
 *
 * Появление плавное — `sf-pop-in` из моушен-системы (мягкий подъём с лёгким масштабом),
 * а не мгновенная подстановка: резкое появление у самого пальца читается как рывок.
 *
 * Мышь и клавиатура работают как раньше: там `onOpenChange` от Radix, задержки провайдера
 * и наведение. Ветка «палец» включается только на грубом указателе — по `pointerType`
 * самого события, а не по ширине экрана: планшет с мышью не должен получать поведение
 * пальца, а телефон в альбомной — поведение мыши.
 */
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
  const [open, setOpen] = React.useState(false)
  // Касание «ведёт» подсказку само: пока палец на кнопке, `onOpenChange` от Radix
  // игнорируется — иначе он закрыл бы её на том же нажатии.
  const touching = React.useRef(false)

  if (!label) return <>{children}</>

  const holdOn = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return
    touching.current = true
    setOpen(true)
  }
  const holdOff = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return
    touching.current = false
    setOpen(false)
  }

  return (
    <TooltipPrimitive.Root
      delayDuration={delay}
      open={open}
      onOpenChange={(next) => {
        if (touching.current) return
        setOpen(next)
      }}
    >
      {/* Обработчики на ОБЁРТКЕ триггера, а не на children: компонент намеренно не
          пробрасывает пропы внутрь (см. предупреждение о порядке выше), и повесить их на
          чужую кнопку значило бы перетереть её собственные. `asChild` при этом сохраняем —
          иначе в разметке появится лишний узел и сломается вёрстка рядов. */}
      <TooltipPrimitive.Trigger
        asChild
        onPointerDown={holdOn}
        onPointerUp={holdOff}
        onPointerCancel={holdOff}
        // Палец уехал с кнопки, не отпуская, — это тоже конец удержания.
        onPointerLeave={holdOff}
      >
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="sf-pop-in z-60 max-w-[15rem] rounded-md border border-border bg-surface px-2 py-1 text-caption leading-snug text-ink shadow-card"
        >
          {label}
          <TooltipPrimitive.Arrow className="fill-surface" width={10} height={5} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
