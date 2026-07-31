import * as React from 'react'
import { cn } from '@/shared/lib/cn'

// Единый бейдж/чип. Варианты:
//   outline — нейтральная рамка (default-метки, теги-факты)
//   ok      — позитивный статус (Latest, accepted)
//   accent  — акцентный (open-статус, AI-метки)
//   soft    — тихая подложка surface-2 (счётчики, вторичные метки)
//   danger  — блокирующий статус (flagged, rejected, takedown)
//   warn    — требующий внимания (pending, deprecated, pre-release)

export type BadgeVariant = 'outline' | 'ok' | 'accent' | 'soft' | 'danger' | 'warn'

const VARIANTS: Record<BadgeVariant, string> = {
  outline: 'border border-border text-muted',
  ok: 'bg-ok/15 text-ok',
  accent: 'bg-(--accent-soft) text-accent',
  soft: 'bg-surface-2 text-ink-2',
  // Рецепт «рамка /40 + фон /10» — самый читаемый из трёх бытовавших инлайн-версий.
  danger: 'border border-danger/40 bg-danger/10 text-danger',
  warn: 'border border-warn/40 bg-warn/10 text-warn',
}

export function Badge({
  variant = 'outline',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', VARIANTS[variant], className)}
      {...props}
    />
  )
}
