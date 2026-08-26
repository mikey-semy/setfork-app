import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'

// Единая секция настроек (Ф4 трека ui-system): карточка + заголовок + опц.
// пояснение + содержимое + опц. футер-ряд действий за разделителем. До неё
// каркас повторялся в 9+ файлах с тремя разными отступами заголовка (mb-1/3/4)
// и футером-рядом в четырёх вариациях. Ширина — та же читаемая колонна 860,
// что и у карточек /admin (поле на два метра удобнее не становится).
// Сохранение форм — FormSaveBar (липкая полоса), НЕ кнопка в футере.

export function SettingsSection({
  id,
  title,
  hint,
  children,
  footer,
  className,
}: {
  id?: string
  title: ReactNode
  /** Пояснение под заголовком (13px ink-2). */
  hint?: ReactNode
  children: ReactNode
  /** Ряд справа за разделителем — вторичные действия (не «Сохранить»). */
  footer?: ReactNode
  className?: string
}) {
  return (
    <section id={id} className={cn('w-full max-w-wide rounded-lg border border-border bg-surface p-5', className)}>
      <div className={cn('font-semibold text-ink', hint ? 'mb-1' : 'mb-4')}>{title}</div>
      {hint && <p className="mb-4 text-body text-ink-2">{hint}</p>}
      {children}
      {footer && <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-4">{footer}</div>}
    </section>
  )
}
