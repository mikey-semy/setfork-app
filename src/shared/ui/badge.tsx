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

/** Форма пилюли. `square` — та же метка, но со скруглением карточки: так рисуют
 *  ссылку-источник у шага и в диффе (два файла держали для неё одинаковый рецепт
 *  константой). Пилюля круглая по умолчанию: метка статуса чаще именно такая. */
export type BadgeShape = 'pill' | 'square'

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

/**
 * Вид метки ОТДЕЛЬНО от самой метки — как `buttonClass` у кнопки.
 *
 * Нужен там, где метку носит не `<span>`: ссылка-источник у шага списка и в диффе.
 * Пока такой формы не было, оба места держали рецепт локальной константой — и это
 * ровно тот случай, когда примитив есть, а воспользоваться им нечем.
 */
export function badgeClass({
  variant = 'outline',
  size = 'sm',
  shape = 'pill',
  className,
}: { variant?: BadgeVariant; size?: BadgeSize; shape?: BadgeShape; className?: string } = {}): string {
  return cn(
    'inline-flex items-center gap-1 py-0.5 font-semibold',
    shape === 'pill' ? 'rounded-full' : 'rounded-md',
    SIZES[size],
    VARIANTS[variant],
    className,
  )
}

export function Badge({
  variant = 'outline',
  size = 'sm',
  shape = 'pill',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant; size?: BadgeSize; shape?: BadgeShape }) {
  return <span className={badgeClass({ variant, size, shape, className })} {...props} />
}
