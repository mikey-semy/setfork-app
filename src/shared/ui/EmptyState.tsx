import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { CONTROL_H, CONTROL_TEXT } from './control'

/** Единый пустой/нейтральный экран: иконка + заголовок + подсказка + опц. кнопка.
 *
 *  Варианты (Ф2 трека ui-system — вместо трёх самопальных форм):
 *   bordered — пунктирная рамка (списки/страницы без содержимого);
 *   plain    — заливка surface с рамкой (таблицы-отчёты, ленты);
 *   inline   — без рамки (строка внутри чужого контейнера/таблицы).
 *  title опционален: короткому состоянию достаточно hint — раньше обязательность
 *  title и была причиной, по которой 19 мест собирали пустоту руками. */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  variant = 'bordered',
  className,
  children,
}: {
  icon?: ReactNode
  title?: string
  hint?: string
  action?: { href: string; label: string }
  variant?: 'bordered' | 'plain' | 'inline'
  className?: string
  /** Доп. содержимое под hint (вторичные ссылки и т.п.) — редкий случай. */
  children?: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        variant === 'bordered' && 'rounded-lg border border-dashed border-border px-6 py-16',
        variant === 'plain' && 'rounded-lg border border-border bg-surface px-6 py-10',
        variant === 'inline' && 'px-4 py-10',
        className,
      )}
    >
      {icon && <div className="text-muted">{icon}</div>}
      {title && <div className="text-body-lg font-semibold text-ink">{title}</div>}
      {hint && <p className="max-w-form text-body text-ink-2">{hint}</p>}
      {children}
      {action && (
        <Link
          href={action.href}
          className={cn(
            'mt-1 inline-flex items-center rounded-md bg-primary px-3.5 font-semibold text-primary-fg',
            CONTROL_H.md,
            CONTROL_TEXT.md,
          )}
        >
          {action.label}
        </Link>
      )}
    </div>
  )
}
