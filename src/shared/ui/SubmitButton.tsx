'use client'

import { useFormStatus } from 'react-dom'
import { Button, type ButtonSize, type ButtonVariant } from './button'

/**
 * Кнопка submit, которая сама блокируется на время отправки формы (server action).
 * Защищает от двойного клика/повторной отправки; должна быть ВНУТРИ <form action=...>.
 * Оформление — общий Button (по умолчанию primary/md из шкалы control.ts):
 * рукописные классы главной кнопки в формах больше не нужны.
 */
export function SubmitButton({
  children,
  className,
  variant = 'primary',
  size = 'md',
  'aria-label': ariaLabel,
  formAction,
}: {
  children: React.ReactNode
  className?: string
  variant?: ButtonVariant
  size?: ButtonSize
  'aria-label'?: string
  /** Своё действие для этой кнопки. Нужно формам с ДВУМЯ исходами (сохранить /
   *  опубликовать): вторая кнопка обязана отправлять те же поля, что видит человек,
   *  а не жить в отдельной форме со своим, уже устаревшим состоянием. */
  formAction?: (formData: FormData) => void | Promise<void>
}) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={pending}
      aria-busy={pending}
      aria-label={ariaLabel}
      formAction={formAction}
      className={className}
    >
      {children}
    </Button>
  )
}
