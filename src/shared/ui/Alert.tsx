import * as React from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

// Единый баннер состояния (Ф1 трека ui-system): ошибки форм (?e=),
// предупреждения, успех. Заменяет инлайн-рецепты border-danger/40 bg-danger/10
// в их пяти вариациях прозрачности. Эталон — /admin/ui-kit.

export type AlertVariant = 'danger' | 'warn' | 'ok' | 'info'

const VARIANTS: Record<AlertVariant, { box: string; icon: React.ComponentType<{ size?: number | string; className?: string }> }> = {
  danger: { box: 'border-danger/40 bg-danger/10 text-danger', icon: AlertCircle },
  warn: { box: 'border-warn/40 bg-warn/10 text-warn', icon: AlertTriangle },
  ok: { box: 'border-ok/40 bg-ok/10 text-ok', icon: CheckCircle2 },
  info: { box: 'border-border bg-surface-2 text-ink-2', icon: Info },
}

export function Alert({
  variant = 'info',
  className,
  children,
}: {
  variant?: AlertVariant
  className?: string
  children: React.ReactNode
}) {
  const { box, icon: Icon } = VARIANTS[variant]
  return (
    <div role={variant === 'danger' ? 'alert' : 'status'} className={cn('flex items-start gap-2 rounded-md border px-3.5 py-2.5 text-[0.8125rem]', box, className)}>
      <Icon size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0 [overflow-wrap:anywhere]">{children}</div>
    </div>
  )
}
