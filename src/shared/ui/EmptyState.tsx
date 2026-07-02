import Link from 'next/link'
import type { ReactNode } from 'react'

/** Единый пустой/нейтральный экран: иконка + заголовок + подсказка + опц. кнопка. */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode
  title: string
  hint?: string
  action?: { href: string; label: string }
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <div className="text-[14px] font-semibold text-ink">{title}</div>
      {hint && <p className="max-w-[380px] text-[13px] text-ink-2">{hint}</p>}
      {action && (
        <Link
          href={action.href}
          className="mt-1 rounded-md bg-primary px-4 py-2 text-[13px] font-semibold text-primary-fg"
        >
          {action.label}
        </Link>
      )}
    </div>
  )
}
