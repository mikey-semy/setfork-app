'use client'

import { useFormStatus } from 'react-dom'

/**
 * Кнопка submit, которая сама блокируется на время отправки формы (server action).
 * Защищает от двойного клика/повторной отправки; должна быть ВНУТРИ <form action=...>.
 */
export function SubmitButton({
  children,
  className,
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode
  className?: string
  'aria-label'?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} aria-busy={pending} aria-label={ariaLabel} className={`${className ?? ''} disabled:opacity-60`}>
      {children}
    </button>
  )
}
