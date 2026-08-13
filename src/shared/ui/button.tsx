import * as React from 'react'
import { buttonClass, type ButtonSize, type ButtonTouch, type ButtonVariant } from './button-style'

// Единая кнопка приложения. Вид (варианты, размеры из шкалы control.ts) живёт в
// button-style.ts — оттуда же его берёт ссылка-кнопка, иначе они разъезжаются.
// Эталон вживую — /admin/ui-kit.

export type { ButtonSize, ButtonTouch, ButtonVariant }

// React 19: ref — обычный проп (ComponentProps его включает), forwardRef не нужен.
export interface ButtonProps extends React.ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Как добирается тач-цель 44px: 'grow' — растёт кнопка, 'hit' — только зона нажатия. */
  touch?: ButtonTouch
}

// Дефолт md — ТОТ ЖЕ, что у Input/SelectTrigger/SearchField (02.08.2026): пока
// кнопка молчком бралась sm, а поле md, любой ряд «поле + кнопка» без явных
// пропов расходился по высоте на ступень. Совпадение по умолчанию — смысл шкалы.
export function Button({ variant = 'outline', size = 'md', touch = 'grow', className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      // eslint-disable-next-line react/button-has-type -- примитив безопасен по построению: дефолт 'button' задан в сигнатуре, submit — только явным пропом
      type={type}
      className={buttonClass({ variant, size, touch, className })}
      {...props}
    />
  )
}
