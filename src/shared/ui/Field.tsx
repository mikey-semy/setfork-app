import * as React from 'react'
import { cn } from '@/shared/lib/cn'

// Единая анатомия строки формы: подпись + контрол + подсказка + ошибка (Ф1
// трека ui-system). Снимает 14 локальных label-констант и три способа показа
// ошибок. Эталон — /admin/ui-kit.
//
// Связка подписи с контролом:
//  - без htmlFor поле ОБОРАЧИВАЕТСЯ в <label> — клик по подписи фокусирует
//    контрол без всякой возни с id (работает в серверных компонентах);
//  - htmlFor — для случаев, когда внутри не один контрол (ряды, группы):
//    рендерится <div> + <label htmlFor>.

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
  const caption = <span className="mb-1.5 block text-[12.5px] font-semibold text-ink-2">{label}</span>
  const tail = (
    <>
      {error != null && error !== '' && <span className="mt-1 block text-[12.5px] text-danger">{error}</span>}
      {hint != null && hint !== '' && <span className="mt-1 block text-[12.5px] text-muted">{hint}</span>}
    </>
  )
  if (htmlFor) {
    return (
      <div className={cn('block', className)}>
        <label htmlFor={htmlFor} className="cursor-pointer">
          {caption}
        </label>
        {children}
        {tail}
      </div>
    )
  }
  return (
    <label className={cn('block', className)}>
      {caption}
      {children}
      {tail}
    </label>
  )
}
