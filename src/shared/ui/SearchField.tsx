'use client'

import { useRef } from 'react'
import { Search, X } from 'lucide-react'
import { CONTROL_H, CONTROL_PX, CONTROL_TEXT, ICON_SIZE, TOUCH_MIN_H, type ControlSize } from './control'

type Size = ControlSize

// Размеры БЕРУТСЯ ИЗ ШКАЛЫ, а не перечисляются здесь. До 26.08.2026 в этом файле
// стояла собственная таблица с лишней ступенью `hero` (44px) — то есть рядом с
// общей шкалой жила вторая, на одну ступень. Стоило это ровно того, чего и должно
// было: ряд героя разъезжался (кнопка отправки 34px против поля 44px), а узда
// молчала, потому что высота была записана произвольным значением.
//
// Теперь 44px — это ступень `xl` общей шкалы, и поле поддерживает ВСЕ ступени до
// одной: примитив без какой-то ступени вынуждает ряд собираться из разных
// (замечание владельца 13.08.2026).
const SIZES: Record<Size, { box: string; text: string; icon: number; clear: number }> = Object.fromEntries(
  (['xs', 'sm', 'md', 'lg', 'xl'] as const).map((s) => [
    s,
    { box: `${CONTROL_H[s]} ${CONTROL_PX[s]}`, text: CONTROL_TEXT[s], icon: ICON_SIZE[s], clear: ICON_SIZE[s] },
  ]),
) as Record<Size, { box: string; text: string; icon: number; clear: number }>

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
  /**
   * grow — видимая рамка добирает 44px на грубом указателе; fixed — держит ступень шкалы.
   *
   * ⚠️ ДЕФОЛТ `fixed` с 27.08.2026, и это возврат к решению, которое уже было принято.
   * В `FIELD_BOX` (control.ts) записано дословно: «роста до 44 на сенсоре здесь НЕТ (снят
   * 13.08.2026): поле в ряду с кнопкой обязано совпасть с ней по высоте, а кнопка на
   * сенсоре остаётся 32px». Input, Select и TagInput этому следуют — SearchField
   * единственный сохранил рост и потому единственный разъезжался с соседями.
   *
   * Как это выглядело: владелец видел кнопку ниже поиска в ТРЁХ разных местах (страница
   * предложений, обсуждения, шапка), а в шапке рост поля ещё и раздувал полосу с 53 до
   * 65px. Проп `fixed` существовал, и в его же описании был назван этот самый случай, —
   * но передавать его должен был каждый вызывающий, и ни один не передал. Правило,
   * которое надо помнить на каждом вызове, не работает: оно обязано быть дефолтом.
   */
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
  touch = 'fixed',
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
