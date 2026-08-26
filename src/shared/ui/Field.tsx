import * as React from 'react'
import { cn } from '@/shared/lib/cn'

// Единая анатомия строки формы: подпись + контрол + подсказка + ошибка (Ф1
// трека ui-system). Снимает 14 локальных label-констант и три способа показа
// ошибок. Эталон — /admin/ui-kit.
//
// Связка подписи с контролом:
//  - без htmlFor поле ОБОРАЧИВАЕТСЯ в <label> — клик по подписи фокусирует
//    контрол без возни с id (работает в серверных компонентах);
//  - htmlFor — для случаев, когда внутри не один контрол (ряды, группы).
//
// Доступность (два дожима Codex по #611/#618): hint/error живут ВНЕ label —
// не попадают в accessible name; и связываются с контролом через
// aria-describedby (useId доступен в серверных компонентах), а ошибка несёт
// role="alert" — скринридер объявляет её появление. Инъекция describedby —
// best-effort: только когда children — один элемент.

export function Field({
  label,
  hint,
  error,
  htmlFor,
  className,
  children,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  htmlFor?: string
  className?: string
  children: React.ReactNode
}) {
  const uid = React.useId()
  const hasHint = hint != null && hint !== ''
  const hasError = error != null && error !== ''
  const hintId = hasHint ? `${uid}-hint` : undefined
  const errId = hasError ? `${uid}-err` : undefined
  const describedBy = [errId, hintId].filter(Boolean).join(' ') || undefined

  let control = children
  if (describedBy && React.isValidElement(children) && React.Children.count(children) === 1) {
    const prev = (children.props as { 'aria-describedby'?: string })['aria-describedby']
    control = React.cloneElement(children as React.ReactElement<{ 'aria-describedby'?: string }>, {
      'aria-describedby': prev ? `${prev} ${describedBy}` : describedBy,
    })
  }

  const caption = <span className="mb-1.5 block text-body-sm font-semibold text-ink-2">{label}</span>
  const tail = (
    <>
      {hasError && (
        <span id={errId} role="alert" className="mt-1 block text-body-sm text-danger">
          {error}
        </span>
      )}
      {hasHint && (
        <span id={hintId} className="mt-1 block text-body-sm text-muted">
          {hint}
        </span>
      )}
    </>
  )
  if (htmlFor) {
    return (
      <div className={cn('block', className)}>
        <label htmlFor={htmlFor} className="cursor-pointer">
          {caption}
        </label>
        {control}
        {tail}
      </div>
    )
  }
  return (
    <div className={cn('block', className)}>
      <label className="block">
        {caption}
        {control}
      </label>
      {tail}
    </div>
  )
}
