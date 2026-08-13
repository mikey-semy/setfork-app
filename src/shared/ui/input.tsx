import * as React from 'react'
import { cn } from '@/shared/lib/cn'
import { CONTROL_H, CONTROL_PX, CONTROL_TEXT, FIELD_BOX, type ControlSize } from './control'

// Единый текстовый инпут (поисковые поля — отдельный SearchField).
// Размеры — из общей шкалы control.ts: высота и кегль совпадают с Button/Select
// того же размера, ряды форм не разъезжаются. Эталон — /admin/ui-kit.

export type InputSize = ControlSize

// React 19: ref — обычный проп (ComponentProps его включает), forwardRef не нужен.
export interface InputProps extends Omit<React.ComponentProps<'input'>, 'size'> {
  size?: InputSize
  /** Иконочная кнопка ВНУТРИ поля справа (подтянуть заголовок ссылки, очистить,
   *  показать пароль). Живёт в примитиве, а не собирается обёрткой в каждой фиче:
   *  иначе у каждой свои отступы, и кнопка то накрывает текст, то съезжает по
   *  вертикали (так было у строки ссылки — жалоба владельца 09.08.2026). */
  trailing?: React.ReactNode
}

export function Input({ size = 'md', className, trailing, ...props }: InputProps) {
  const field = (
    <input
      className={cn(
        'w-full',
        FIELD_BOX,
        CONTROL_H[size],
        CONTROL_PX[size],
        CONTROL_TEXT[size],
        // Место под кнопку: текст под неё не заезжает.
        trailing && 'pr-9',
        className,
      )}
      {...props}
    />
  )
  if (!trailing) return field
  return (
    <div className={cn('relative', className?.includes('flex-1') && 'min-w-0 flex-1')}>
      {field}
      {/* Кнопка прижата к правому краю и по центру высоты — одинаково для всех
          размеров шкалы, без ручных отступов на стороне вызывающего. */}
      <span className="absolute inset-y-0 right-1 flex items-center">{trailing}</span>
    </div>
  )
}
