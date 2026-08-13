import { cn } from '@/shared/lib/cn'
import { CONTROL_H, CONTROL_TEXT, TOUCH_MIN_H, type ControlSize } from './control'

// Вид кнопки живёт ОТДЕЛЬНО от самой кнопки: те же классы нужны ссылке-кнопке
// (навигация, которая обязана выглядеть кнопкой, но остаться ссылкой — открываться
// в новой вкладке, копироваться, читаться как переход). Раньше такой рецепт
// переписывали в фичах руками, и ссылки расходились с кнопками по высоте и фокусу.

// Варианты покрывают весь используемый спектр:
//   primary — главное действие (bg-primary)
//   outline — вторичное (рамка border, hover усиливает рамку)
//   ghost   — «тихая» (без рамки, hover-подложка)
//   danger  — деструктивная (текст/hover в danger)
//   ok      — «получить/забрать» (зелёная, как Code у GitHub)
export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'dangerSolid' | 'ok'
export type ButtonSize = ControlSize

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg hover:opacity-90',
  outline: 'border border-border bg-surface-2 text-ink hover:border-border-strong',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'text-muted hover:bg-danger/10 hover:text-danger', // «тихая» (иконка-корзинка)
  dangerSolid: 'bg-danger text-white hover:opacity-90', // залитая деструктивная (удалить аккаунт/список)
  // Зелёная кнопка «Получить» была единственной рукописной кнопкой в ряду шапки
  // списка — и единственной, которая не добирала тач-цель. Стала вариантом, а не
  // осталась исключением: токен --ok-solid читается с белым текстом в обеих темах.
  ok: 'bg-(--ok-solid) text-white hover:opacity-90',
}

// px у кнопок шире полей того же размера — тексту в кнопке нужен воздух.
const SIZES: Record<ButtonSize, string> = {
  xs: 'px-2 gap-1',
  sm: 'px-2.5 gap-1.5',
  md: 'px-3.5 gap-1.5',
  lg: 'px-4 gap-2',
}

export function buttonClass({ variant = 'outline', size = 'md', className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cn(
    'inline-flex items-center justify-center rounded-md font-semibold outline-hidden transition-colors focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[variant],
    CONTROL_H[size],
    // Шкала 24/28/32 — про ВИД под мышью. Пальцу нужна цель 44 (Apple HIG, у
    // Material 48dp), и кнопка с текстом до неё дорастает высотой: на телефоне
    // ряд кнопок такой высоты — норма мобильных интерфейсов, а не раздутие.
    TOUCH_MIN_H,
    CONTROL_TEXT[size],
    SIZES[size],
    className,
  )
}
