import * as React from 'react'
import { cn } from '@/shared/lib/cn'
import { CONTROL_H, CONTROL_PX, CONTROL_TEXT, FIELD_BOX, FIELD_TEXT_MOBILE, type ControlSize } from './control'

// Единый текстовый инпут (поисковые поля — отдельный SearchField).
// Размеры — из общей шкалы control.ts: высота и кегль совпадают с Button/Select
// того же размера, ряды форм не разъезжаются. Эталон — /admin/ui-kit.

export type InputSize = ControlSize

// React 19: ref — обычный проп (ComponentProps его включает), forwardRef не нужен.
export interface InputProps extends Omit<React.ComponentProps<'input'>, 'size'> {
  size?: InputSize
}

export function Input({ size = 'md', className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'w-full',
        FIELD_BOX,
        CONTROL_H[size],
        CONTROL_PX[size],
        CONTROL_TEXT[size],
        FIELD_TEXT_MOBILE,
        className,
      )}
      {...props}
    />
  )
}
