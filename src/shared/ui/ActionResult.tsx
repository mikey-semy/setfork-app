import * as React from 'react'
import { Check, X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

/**
 * РЕЗУЛЬТАТ ДЕЙСТВИЯ ОДНОЙ СТРОКОЙ — рядом с кнопкой, а не баннером.
 *
 * `Alert` для этого тяжёл: он несёт рамку и фон, то есть занимает блок. Здесь нужна
 * строка «✔ Отправлено» в ряду с кнопкой, поэтому кусочек свой — но форма не выдумана,
 * а взята у `QuizBlock` («Верно» / «Неверно»), где она сложилась первой.
 *
 * Заведён потому, что эмодзи в подписи появлялось ВТОРОЙ раз («Отправлено ✅»,
 * «Ключи сгенерированы ✅»), а канон значков в проекте — lucide. Эмодзи рисуется
 * шрифтом системы: на разных платформах разный кегль и цвет, мимо темы и мимо шкалы.
 *
 * Мобила: значок `shrink-0`, текст переносится. Длинная ошибка обязана перенестись,
 * а не распереть ряд — у `EmailSettingsForm` в эту строку приходит текст ошибки SMTP,
 * и он бывает в полстроки.
 */
export function ActionResult({
  ok,
  className,
  children,
}: {
  ok: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      role="status"
      className={cn(
        'inline-flex min-w-0 items-start gap-1.5 text-body-sm',
        ok ? 'text-ok' : 'text-danger',
        className,
      )}
    >
      {ok ? <Check size={15} className="mt-0.5 shrink-0" /> : <X size={15} className="mt-0.5 shrink-0" />}
      <span className="min-w-0">{children}</span>
    </span>
  )
}
