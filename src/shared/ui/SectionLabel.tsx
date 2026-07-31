import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'

/**
 * Секционный лейбл-«eyebrow» (О СПИСКЕ, КОНТРИБЬЮТОРЫ, СПИСКИ, вкладки Получить и т.п.).
 * Единый стиль в одном месте — обычный шрифт (не моно), мелкий, ЗАГЛАВНЫЕ, разрядка,
 * приглушённый. Раньше это был продублированный в ~10 местах класс с `font-mono`.
 * Контекстные отступы/флекс с иконкой передаются через className.
 */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('text-[0.6875rem] font-semibold uppercase tracking-[0.07em] text-muted', className)}>
      {children}
    </div>
  )
}
