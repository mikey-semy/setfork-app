import { cn } from '@/shared/lib/cn'
import { CONTROL_H, CONTROL_TEXT, TOUCH_HIT, TOUCH_MIN_H, type ControlSize } from './control'

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

/**
 * Чем добирается тач-цель 44px. `hit` (ПО УМОЛЧАНИЮ) растит только невидимую
 * зону нажатия; `grow` растит саму кнопку.
 *
 * Дефолт сменён 13.08.2026 по прямому указанию владельца: «у кнопки Получения и
 * Прогона был корректный размер, я говорил равняться на ЭТОТ размер, а ты всё
 * сделал как у кнопки веток, которая была больше». Так и было: рукописные кнопки
 * ряда не получали TOUCH_MIN_H и оставались 32px, а переведённые на примитив
 * вырастали до 44 — и, выравнивая ряд, я подтянул его к БОЛЬШЕМУ. Ряд стал
 * ровным, но не той высоты, которую просили.
 *
 * Выравнивание к меньшему — ещё и «как у других»: у GitHub кнопки панели
 * репозитория остаются 32px и на телефоне, тач-цель добирается зоной нажатия,
 * а не раздуванием кнопки.
 *
 * Живёт ЗДЕСЬ, а не в обёртке: TOUCH_MIN_H подмешивается этой функцией, и обёртка
 * снаружи его не отменяет — классы не конфликтуют, а складываются. Из-за этого
 * первая версия `IconButton touch="hit"` не работала вовсе: крестик всё равно
 * дорастал до 44px и раздувал шапку панели до 60px на телефоне — ровно то, что
 * режим и должен был предотвратить (находка авто-ревью по fe#788).
 */
export type ButtonTouch = 'grow' | 'hit'

export function buttonClass({
  variant = 'outline',
  size = 'md',
  touch = 'hit',
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; touch?: ButtonTouch; className?: string } = {}): string {
  return cn(
    // `whitespace-nowrap` — НЕСУЩЕЕ, а не косметика. Высоту кнопки задаёт шкала
    // (CONTROL_H), и подпись, перенесённая на вторую строку, в эту высоту не влезает:
    // текст вылезает за границы, и первая строка оказывается ВЫШЕ верхнего края кнопки.
    // Ровно так это и выглядело: «More» на главной и «New discussion» на обсуждениях.
    // Кнопке с длинной подписью в узком месте нужен `truncate` от вызывающего — но
    // ломать высоту переносом она не должна никогда.
    'inline-flex items-center justify-center whitespace-nowrap rounded-md font-semibold outline-hidden transition-colors focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[variant],
    CONTROL_H[size],
    // Шкала 24/28/32 — это ВИД, и он один на все указатели. Пальцу нужна цель 44
    // (Apple HIG, у Material 48dp), но добирается она НЕВИДИМОЙ зоной, а не ростом
    // кнопки: иначе ряд на телефоне выглядит иначе, чем задуман. `grow` оставлен
    // для одиночной кнопки формы во всю ширину, где расти некуда и незачем мешать.
    touch === 'hit' ? TOUCH_HIT : TOUCH_MIN_H,
    CONTROL_TEXT[size],
    SIZES[size],
    className,
  )
}
