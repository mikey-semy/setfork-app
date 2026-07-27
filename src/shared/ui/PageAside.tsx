import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { SectionLabel } from './SectionLabel'

/**
 * Правая колонка страницы (боковая панель) — ОДИН источник правды.
 *
 * До этого колонка была продублирована разметкой: на странице списка свой
 * `<aside>` с шириной и отступами, на странице задачи — двухколоночный мета-блок,
 * а для PR завёлся бы третий вариант. Теперь ширина, зазор и поведение при печати
 * живут здесь; страницы отвечают только за содержимое.
 *
 * На узком экране колонка становится обычным блоком под контентом — отдельного
 * мобильного варианта не нужно.
 */
export function PageAside({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <aside className={cn('flex shrink-0 flex-col gap-4 print:hidden lg:w-[300px]', className)}>{children}</aside>
  )
}

/**
 * Карточка внутри боковой колонки: рамка + фон + необязательный лейбл-«eyebrow».
 * Тот же вид, что у карточек «О СПИСКЕ»/«Ссылаются на этот список», но без
 * повторения классов в каждой странице.
 */
export function AsideCard({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode
  /** Правый угол шапки карточки (ссылка «все», кнопка) — по мобильному правилу углов. */
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-lg border border-border bg-surface p-4', className)}>
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title ? <SectionLabel>{title}</SectionLabel> : <span />}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}
