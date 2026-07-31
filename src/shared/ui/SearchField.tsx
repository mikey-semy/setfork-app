'use client'

import { useRef } from 'react'
import { Search, X } from 'lucide-react'
import { CONTROL_H, CONTROL_PX, CONTROL_TEXT, FIELD_TEXT_MOBILE } from './control'

type Size = 'lg' | 'md' | 'sm' | 'xs'

// xs..md — общая шкала контролов (control.ts): высота ряда совпадает с
// Button/Input/Select. lg — герой-поиск главной, живёт выше шкалы.
const SIZES: Record<Size, { box: string; text: string; icon: number; clear: number }> = {
  lg: { box: 'h-[44px] px-3.5', text: `text-[15px] ${FIELD_TEXT_MOBILE}`, icon: 16, clear: 16 },
  md: { box: `${CONTROL_H.md} ${CONTROL_PX.md}`, text: `${CONTROL_TEXT.md} ${FIELD_TEXT_MOBILE}`, icon: 15, clear: 15 },
  sm: { box: `${CONTROL_H.sm} ${CONTROL_PX.sm}`, text: `${CONTROL_TEXT.sm} ${FIELD_TEXT_MOBILE}`, icon: 14, clear: 14 },
  xs: { box: `${CONTROL_H.xs} ${CONTROL_PX.xs}`, text: `${CONTROL_TEXT.xs} ${FIELD_TEXT_MOBILE}`, icon: 12, clear: 13 },
}

export interface SearchFieldProps {
  value: string
  onValueChange: (v: string) => void
  onClear?: () => void
  placeholder?: string
  ariaLabel?: string
  clearLabel?: string
  size?: Size
  /** 'box' — своя рамка (по умолчанию); 'bare' — без рамки, для вложения в готовый контейнер. */
  variant?: 'box' | 'bare'
  /** Имя для нативной отправки формы (GET). */
  name?: string
  autoFocus?: boolean
  /** Слой раскрашенных токенов под прозрачным текстом инпута (для QualifierSearch). */
  overlay?: React.ReactNode
  /** Показывается справа, ПОКА поле пустое (например kbd «/»); при вводе его сменяет ×. */
  hint?: React.ReactNode
  className?: string
  inputClassName?: string
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  onFocus?: React.FocusEventHandler<HTMLInputElement>
  onBlur?: React.FocusEventHandler<HTMLInputElement>
  onScroll?: React.UIEventHandler<HTMLInputElement>
  /** React 19: ref — обычный проп. Ожидается RefObject (используем .current для фокуса). */
  ref?: React.RefObject<HTMLInputElement | null>
}

/**
 * Единое поле поиска для всего приложения: лупа + input + кнопка «очистить» (×).
 * Контролируемое. `overlay` даёт подсветку значений (текст инпута становится
 * прозрачным), `hint` — правый слот, видимый пока поле пустое, `variant='bare'`
 * убирает рамку для вложения в свой контейнер.
 */
export function SearchField({
  value,
  onValueChange,
  onClear,
  placeholder,
  ariaLabel,
  clearLabel = 'Clear',
  size = 'md',
  variant = 'box',
  name,
  autoFocus,
  overlay,
  hint,
  className,
  inputClassName,
  onKeyDown,
  onFocus,
  onBlur,
  onScroll,
  ref,
}: SearchFieldProps) {
  const innerRef = useRef<HTMLInputElement>(null)
  const inputRef = ref ?? innerRef
  const s = SIZES[size]
  const hasValue = value.length > 0
  const box =
    variant === 'bare'
      ? 'flex items-center gap-2'
      : `flex items-center gap-2 rounded-md border border-border bg-surface-2 ${s.box} focus-within:border-border-strong`

  function clear() {
    onValueChange('')
    onClear?.()
    inputRef.current?.focus()
  }

  return (
    <div className={`${box} ${className ?? ''}`}>
      <Search size={s.icon} className="shrink-0 text-muted" />
      <div className="relative min-w-0 flex-1">
        {overlay}
        <input
          ref={inputRef}
          name={name}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
          onScroll={onScroll}
          placeholder={placeholder}
          aria-label={ariaLabel ?? placeholder}
          className={`relative w-full bg-transparent ${s.text} outline-hidden placeholder:text-muted ${overlay ? 'text-transparent caret-ink' : 'text-ink'} ${inputClassName ?? ''}`}
        />
      </div>
      {hasValue ? (
        <button
          type="button"
          aria-label={clearLabel}
          onMouseDown={(e) => e.preventDefault()}
          onClick={clear}
          className="grid shrink-0 place-items-center rounded-md text-muted outline-hidden hover:text-ink focus-visible:ring-2 focus-visible:ring-border-strong"
        >
          <X size={s.clear} />
        </button>
      ) : (
        hint
      )}
    </div>
  )
}
