'use client'

import * as React from 'react'
import { cn } from '@/shared/lib/cn'
import { CONTROL_H, CONTROL_PX, CONTROL_TEXT, TOUCH_HIT } from './control'

/**
 * Пилюля-ПЕРЕКЛЮЧАТЕЛЬ: тип списка, объём, метка, реакция. Нажимается и умеет
 * состояние «выбрано».
 *
 * Отличается от `Badge` тем же, чем ссылка от текста: Badge — это метка, которую
 * читают, Chip — контрол, который нажимают. Отсюда всё, чего у метки нет: тач-цель,
 * фокус, `aria-pressed`, состояние `disabled`.
 *
 * Заведён 26.08.2026 по замеру `ui-parity`: рецепт «rounded-full border px-3 py-1»
 * жил в десяти местах (выбор типа и объёма генерации, метки задачи, реакции), и
 * высоту в нём считали ОТСТУПЫ — то есть совпадала она с соседями только случайно.
 * Здесь высота приходит из шкалы (`sm`, 28px), а до 44px на пальце добирает
 * невидимая зона: соседи по ряду стоят сбоку, растить сам чип нельзя.
 */
export function Chip({
  selected = false,
  className,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & { selected?: boolean }) {
  return (
    // type всегда "button": чип живёт и внутри форм (метки задачи, реакции), и там
    // дефолтный submit отправлял бы форму по выбору метки.
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border outline-hidden transition-colors focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40',
        CONTROL_H.sm,
        CONTROL_TEXT.sm,
        CONTROL_PX.md,
        TOUCH_HIT,
        selected ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-2 hover:text-ink',
        className,
      )}
      {...props}
    />
  )
}
