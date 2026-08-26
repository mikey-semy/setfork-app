import * as React from 'react'
import { cn } from '@/shared/lib/cn'

// Единый бейдж/чип. Варианты:
//   outline — нейтральная рамка (default-метки, теги-факты)
//   chip    — рамка + тихая подложка (самый частый рецепт: 12 мест писали его руками)
//   ok      — позитивный статус (Latest, accepted)
//   accent  — акцентный (open-статус, AI-метки)
//   soft    — тихая подложка surface-2 (счётчики, вторичные метки)
//   danger  — блокирующий статус (flagged, rejected, takedown)
//   warn    — требующий внимания (pending, deprecated, pre-release)
//   accentSolid / dangerSolid / okSolid — залитые: метка, которая обязана перебить всё
//             вокруг (статус задачи, счётчик уведомлений). Зелёный берётся из --ok-solid:
//             обычный --ok под белым текстом не добирает контраста
//   dashed  — пунктирная рамка: пустое место, куда что-то встанет
//
// Размер — ось, а не вариант: пилюли жили в двух кеглях (caption и body-sm), и
// половина мест обходила примитив только из-за отсутствующей ступени (замер
// 26.08.2026: 62 рукописные пилюли в 39 рецептах при живом Badge в 17 файлах).

export type BadgeVariant =
  | 'outline'
  | 'chip'
  | 'ok'
  | 'accent'
  | 'soft'
  | 'danger'
  | 'warn'
  | 'accentSolid'
  | 'dangerSolid'
  | 'okSolid'
  | 'dashed'

export type BadgeSize = 'sm' | 'md'

const VARIANTS: Record<BadgeVariant, string> = {
  outline: 'border border-border text-muted',
  chip: 'border border-border bg-surface-2 text-ink-2',
  ok: 'bg-ok/15 text-ok',
  accent: 'bg-accent-soft text-accent',
  soft: 'bg-surface-2 text-ink-2',
  // Рецепт «рамка /40 + фон /10» — самый читаемый из трёх бытовавших инлайн-версий.
  danger: 'border border-danger/40 bg-danger/10 text-danger',
  warn: 'border border-warn/40 bg-warn/10 text-warn',
  accentSolid: 'bg-accent text-white',
  dangerSolid: 'bg-danger text-white',
  okSolid: 'bg-ok-solid text-white',
  dashed: 'border border-dashed border-border text-muted',
}

/** Кегль и горизонтальный отступ ступени. Вертикальный общий: пилюля не растёт. */
const SIZES: Record<BadgeSize, string> = {
  sm: 'px-2 text-caption',
  md: 'px-2.5 text-body-sm',
}

export function Badge({
  variant = 'outline',
  size = 'sm',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant; size?: BadgeSize }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full py-0.5 font-semibold', SIZES[size], VARIANTS[variant], className)}
      {...props}
    />
  )
}
