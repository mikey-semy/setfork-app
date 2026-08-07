import { cn } from '@/shared/lib/cn'
import { Button, type ButtonProps } from './button'
import { ICON_SIZE, TOUCH_BOX, type ControlSize } from './control'

/**
 * Квадратная кнопка с одной иконкой: корзинка, стрелки порядка, «закрыть».
 *
 * Отличается от Button только геометрией — вид, фокус и состояния берутся оттуда,
 * иначе иконочные кнопки разъезжаются с обычными. Подпись обязательна: у иконки нет
 * текста, а без имени кнопка недоступна с экранного диктора (WCAG 4.1.2).
 *
 * На грубом указателе сторона вырастает до тач-цели (TOUCH_BOX) — раньше этот приём
 * копировался по фичам вручную и половину кнопок обходил стороной.
 */
const BOX: Record<ControlSize, string> = {
  xs: 'size-6',
  sm: 'size-7',
  md: 'size-8',
}

export function IconButton({ size = 'md', label, className, children, ...props }: Omit<ButtonProps, 'aria-label'> & { label: string }) {
  return (
    <Button size={size} aria-label={label} className={cn('shrink-0 p-0', BOX[size], TOUCH_BOX, className)} {...props}>
      {children}
    </Button>
  )
}

/** Размер иконки внутри — тот же справочник, что у остальных контролов. */
export const iconSizeFor = (size: ControlSize = 'md'): number => ICON_SIZE[size]
