'use client'

import { useRef } from 'react'
import { Search, X } from 'lucide-react'
import { CONTROL_H, CONTROL_PX, CONTROL_TEXT, ICON_SIZE, TOUCH_MIN_H, type ControlSize } from './control'

type Size = 'hero' | ControlSize

// xs..md — общая шкала контролов (control.ts): высота ряда совпадает с
// Button/Input/Select. hero — поиск-герой главной, он СОЗНАТЕЛЬНО вне шкалы и
// стоит на странице один, ни с чем в ряд не вставая.
//
// ⚠️ Ступени ШКАЛЫ поле обязано поддерживать ВСЕ до одной. Примитив, у которого
// нет какой-то ступени, вынуждает ряд собираться из разных: рядом с кнопкой lg
// такое поле встанет ступенькой, и «одна высота в ряду» перестанет работать
// именно там, где её видно (замечание владельца 13.08.2026).
//
// Ступень называется `hero`, а НЕ `lg`: с 13.08.2026 в шкале есть свой `lg`
// (40px), и одинаковое имя при разной высоте — ловушка того же рода, что и
// разнобой, который эта шкала лечит.
const SIZES: Record<Size, { box: string; text: string; icon: number; clear: number }> = {
  // eslint-disable-next-line no-restricted-syntax -- hero = поиск главной, сознательно вне лестницы ролей (см. коммент выше)
  hero: { box: 'h-[2.75rem] px-3.5', text: 'text-lead', icon: 16, clear: 16 },
  lg: { box: `${CONTROL_H.lg} ${CONTROL_PX.lg}`, text: CONTROL_TEXT.lg, icon: ICON_SIZE.lg, clear: ICON_SIZE.lg },
  md: { box: `${CONTROL_H.md} ${CONTROL_PX.md}`, text: CONTROL_TEXT.md, icon: ICON_SIZE.md, clear: ICON_SIZE.md },
  sm: { box: `${CONTROL_H.sm} ${CONTROL_PX.sm}`, text: CONTROL_TEXT.sm, icon: ICON_SIZE.sm, clear: ICON_SIZE.sm },
  xs: { box: `${CONTROL_H.xs} ${CONTROL_PX.xs}`, text: CONTROL_TEXT.xs, icon: ICON_SIZE.xs, clear: ICON_SIZE.xs },
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
  /** grow — видимая рамка добирает 44px на touch; fixed — сохраняет ступень
   *  шкалы, когда поле стоит в одном ряду с компактными Select/Button. */
  touch?: 'grow' | 'fixed'
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
  touch = 'grow',
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
      : `flex items-center gap-2 rounded-md border border-border bg-surface-2 ${s.box} ${touch === 'grow' ? TOUCH_MIN_H : ''} focus-within:border-border-strong`

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
