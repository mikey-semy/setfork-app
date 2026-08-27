import * as React from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

// Единый баннер состояния (Ф1 трека ui-system): ошибки форм (?e=),
// предупреждения, успех. Заменяет инлайн-рецепты border-danger/40 bg-danger/10
// в их пяти вариациях прозрачности. Эталон — /admin/ui-kit.

export type AlertVariant = 'danger' | 'warn' | 'ok' | 'info' | 'accent'

const VARIANTS: Record<AlertVariant, { box: string; icon: React.ComponentType<{ size?: number | string; className?: string }> }> = {
  danger: { box: 'border-danger/40 bg-danger/10 text-danger', icon: AlertCircle },
  warn: { box: 'border-warn/40 bg-warn/10 text-warn', icon: AlertTriangle },
  ok: { box: 'border-ok/40 bg-ok/10 text-ok', icon: CheckCircle2 },
  info: { box: 'border-border bg-surface-2 text-ink-2', icon: Info },
  // Полоса контекста: «вы смотрите ветку», «версия v3, только чтение», «показано 5 из
  // 40». Не тревога и не успех — сообщение о том, ГДЕ человек находится. Поэтому текст
  // обычного цвета, а тон несёт только рамка, фон и значок: полосу читают, а не пугаются.
  accent: { box: 'border-accent/50 bg-accent-soft text-ink', icon: Info },
}

export function Alert({
  variant = 'info',
  icon,
  action,
  className,
  children,
}: {
  variant?: AlertVariant
  /** Свой значок вместо типового: у полосы ветки это ветка, у сертификата — шапочка.
   *  `null` — без значка вовсе (полоса внутри карточки, где значок уже есть выше). */
  icon?: React.ComponentType<{ size?: number | string; className?: string }> | null
  /** Действие в КОНЦЕ строки: «Открыть предложение», «К текущей версии», «Показать все».
   *  Появление действия меняет раскладку — см. ниже, и это не украшательство. */
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  const { box, icon: Fallback } = VARIANTS[variant]
  const Icon = icon === null ? null : (icon ?? Fallback)
  // Без действия блок читается сверху вниз (значок у ПЕРВОЙ строки текста, `items-start`);
  // с действием он становится ПОЛОСОЙ — одна строка, кнопка справа, и значок обязан
  // встать по центру. Замер 27.08.2026: девять таких плашек были написаны руками, и
  // именно раскладка в них расходилась чаще всего.
  const row = action !== undefined
  return (
    <div
      role={variant === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-2 rounded-md border px-3.5 py-2.5 text-body', row ? 'flex-wrap items-center' : 'items-start', box, className)}
    >
      {Icon && <Icon size={15} className={cn('shrink-0', !row && 'mt-0.5')} />}
      <div className={cn('min-w-0 [overflow-wrap:anywhere]', row && 'flex-1')}>{children}</div>
      {action !== undefined && <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}
