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
  /** Приставка СЛЕВА, внутри рамки: `@` у ника, `/` у адреса, единица у числа.
   *  Заведена 26.08.2026: три места (перенос списка, удаление списка, удаление
   *  аккаунта) рисовали приставку сами — обёртка с рамкой, а внутри голый
   *  `<input class="bg-transparent">`. Копии уже разошлись по отступам, и ни одна
   *  не получала ни высоты из шкалы, ни фокуса примитива. */
  leading?: React.ReactNode
  /** Тон рамки при фокусе: опасное действие подсвечивается красным, а не акцентом. */
  tone?: 'default' | 'danger'
}

export function Input({ size = 'md', className, trailing, leading, tone = 'default', ...props }: InputProps) {
  // С приставкой рамку держит ОБЁРТКА, а поле внутри становится прозрачным: иначе
  // рамок будет две, вложенных одна в другую. Всё остальное — высота, кегль, отступы —
  // по-прежнему из шкалы.
  if (leading) {
    return (
      <div
        className={cn(
          'flex items-center gap-1.5',
          FIELD_BOX,
          CONTROL_H[size],
          CONTROL_PX[size],
          CONTROL_TEXT[size],
          tone === 'danger' ? 'focus-within:border-danger' : 'focus-within:border-accent',
          className,
        )}
      >
        <span className="shrink-0 text-muted">{leading}</span>
        <input className={cn('w-full min-w-0 bg-transparent outline-hidden placeholder:text-muted', CONTROL_TEXT[size])} {...props} />
      </div>
    )
  }
  const field = (
    <input
      className={cn(
        'w-full',
        FIELD_BOX,
        CONTROL_H[size],
        CONTROL_PX[size],
        CONTROL_TEXT[size],
        tone === 'danger' && 'focus-visible:border-danger focus-visible:ring-danger',
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
