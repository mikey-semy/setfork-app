'use client'

import { useId, type ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { FIELD_BOX, TEXT } from './control'

/**
 * Поле с ПЛАВАЮЩЕЙ меткой: пока пусто — метка стоит вместо подсказки внутри поля,
 * с вводом или фокусом она уезжает наверх и уменьшается (решение владельца
 * 09.08.2026; так устроен ввод ссылки в Telegram и поля Material Design).
 *
 * Смысл — не украшение: подпись над каждым полем занимает отдельную строку, и в
 * маленьком окне из двух полей половину высоты составляли подписи. Метка внутри
 * экономит место и при этом НЕ теряется при вводе, в отличие от голого
 * placeholder — им нельзя подписывать поле, потому что он исчезает ровно тогда,
 * когда человек уже не помнит, что вводил.
 *
 * Механика — на CSS (`peer` + `placeholder-shown`), без состояния в JS: меньше
 * кода и нет рассинхрона с реальным содержимым поля.
 */
export function FloatingInput({
  label,
  value,
  onChange,
  hint,
  trailing,
  className,
  inputClassName,
  ...rest
}: {
  label: string
  value: string
  onChange: (v: string) => void
  /** Подсказка формата под полем (например «https://…»). */
  hint?: ReactNode
  /** Иконочная кнопка внутри поля справа. */
  trailing?: ReactNode
  className?: string
  inputClassName?: string
} & Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'className'>) {
  const id = useId()
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="relative">
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          // Пробел, а не пусто: `:placeholder-shown` работает только при наличии
          // placeholder, а видимым он быть не должен — его место занимает метка.
          placeholder=" "
          className={cn(
            'peer w-full px-2.5 pt-5 pb-1.5',
            FIELD_BOX,
            TEXT.body,
            trailing && 'pr-9',
            inputClassName,
          )}
          {...rest}
        />
        <label
          htmlFor={id}
          className={cn(
            'pointer-events-none absolute left-2.5 top-1 text-muted transition-all',
            TEXT.caption,
            // Пусто и без фокуса — метка стоит по центру поля обычным кеглем.
            'peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-[0.8125rem]',
            // Фокус — всегда наверх, даже если ещё ничего не введено.
            'peer-focus:top-1 peer-focus:translate-y-0 peer-focus:text-[0.6875rem] peer-focus:text-accent',
          )}
        >
          {label}
        </label>
        {trailing && <span className="absolute inset-y-0 right-1 flex items-center">{trailing}</span>}
      </div>
      {hint && <span className={cn('px-0.5 text-muted', TEXT.caption)}>{hint}</span>}
    </div>
  )
}
