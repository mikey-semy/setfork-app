import Link from 'next/link'
import { cn } from '@/shared/lib/cn'
import { Button, type ButtonProps } from './button'
import { buttonClass } from './button-style'
import { TOUCH_BOX, type ControlSize } from './control'

/**
 * Квадратная кнопка с одной иконкой: корзинка, стрелки порядка, «закрыть».
 *
 * Отличается от Button только геометрией — вид, фокус и состояния берутся оттуда,
 * иначе иконочные кнопки разъезжаются с обычными. Подпись обязательна: у иконки нет
 * текста, а без имени кнопка недоступна с экранного диктора (WCAG 4.1.2).
 *
 * Тач-цель по умолчанию добирается ЗОНОЙ нажатия, а не ростом квадрата: иконочная
 * кнопка в ряду обязана быть той же высоты, что текстовая рядом, на любом указателе
 * (правило владельца 13.08.2026). `touch="grow"` — когда вокруг есть место и рост
 * уместен. Размер иконки внутри берут из `iconSizeFor` рядом со шкалой.
 */
const BOX: Record<ControlSize, string> = {
  xs: 'size-6',
  sm: 'size-7',
  md: 'size-8',
  lg: 'size-10',
  xl: 'size-11',
}

export function IconButton({
  size = 'md',
  label,
  className,
  href,
  touch = 'hit',
  children,
  ...props
}: Omit<ButtonProps, 'aria-label'> & {
  label: string
  /** Задан — это НАВИГАЦИЯ: рендерим ссылку тем же видом (открывается в новой
   *  вкладке, копируется, читается как переход), а не кнопку с router.push. */
  href?: string
  /**
   * Наследуется от Button. У квадратной кнопки `grow` растит СТОРОНУ (TOUCH_BOX),
   * у текстовой — высоту; смысл один. `hit` нужен в полосах, чью высоту задаёт не
   * кнопка: в шапке панели крестик `grow` раздувал полосу с 44 до 60px на телефоне,
   * и «Выбор ветки» из одного слова выглядел вдвое выше содержимого (замер 13.08.2026).
   */
}) {
  // При 'hit' квадрат НЕ растёт: зону нажатия подмешивает buttonClass (TOUCH_HIT),
  // и он же не добавляет TOUCH_MIN_H — иначе кнопка всё равно вырастала бы.
  const box = cn('shrink-0 p-0', BOX[size], touch === 'grow' && TOUCH_BOX, className)
  if (href) {
    return (
      <Link href={href} aria-label={label} className={buttonClass({ variant: props.variant, size, touch, className: box })}>
        {children}
      </Link>
    )
  }
  return (
    <Button size={size} touch={touch} aria-label={label} className={box} {...props}>
      {children}
    </Button>
  )
}
