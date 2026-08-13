import Link from 'next/link'
import { cn } from '@/shared/lib/cn'
import { Button, type ButtonProps } from './button'
import { buttonClass } from './button-style'
import { TOUCH_BOX, TOUCH_HIT, type ControlSize } from './control'

/**
 * Квадратная кнопка с одной иконкой: корзинка, стрелки порядка, «закрыть».
 *
 * Отличается от Button только геометрией — вид, фокус и состояния берутся оттуда,
 * иначе иконочные кнопки разъезжаются с обычными. Подпись обязательна: у иконки нет
 * текста, а без имени кнопка недоступна с экранного диктора (WCAG 4.1.2).
 *
 * На грубом указателе сторона вырастает до тач-цели (TOUCH_BOX) — раньше этот приём
 * копировался по фичам вручную и половину кнопок обходил стороной. Размер иконки
 * внутри берут из `iconSizeFor` рядом со шкалой.
 */
const BOX: Record<ControlSize, string> = {
  xs: 'size-6',
  sm: 'size-7',
  md: 'size-8',
  lg: 'size-10',
}

export function IconButton({
  size = 'md',
  label,
  className,
  href,
  touch = 'box',
  children,
  ...props
}: Omit<ButtonProps, 'aria-label'> & {
  label: string
  /** Задан — это НАВИГАЦИЯ: рендерим ссылку тем же видом (открывается в новой
   *  вкладке, копируется, читается как переход), а не кнопку с router.push. */
  href?: string
  /**
   * Чем добирается тач-цель 44px:
   * - `box` (по умолчанию) — растёт САМА кнопка. Годится там, где вокруг есть место.
   * - `hit` — растёт невидимая зона нажатия, вид и место в потоке не меняются.
   *   Нужен в полосах, чью высоту задаёт не кнопка: в шапке панели крестик `box`
   *   раздувал полосу с 44 до 60px на телефоне, и «Выбор ветки» из одного слова
   *   выглядел вдвое выше своего содержимого (замер 13.08.2026).
   */
  touch?: 'box' | 'hit'
}) {
  const box = cn('shrink-0 p-0', BOX[size], touch === 'hit' ? TOUCH_HIT : TOUCH_BOX, className)
  if (href) {
    return (
      <Link href={href} aria-label={label} className={buttonClass({ variant: props.variant, size, className: box })}>
        {children}
      </Link>
    )
  }
  return (
    <Button size={size} aria-label={label} className={box} {...props}>
      {children}
    </Button>
  )
}
