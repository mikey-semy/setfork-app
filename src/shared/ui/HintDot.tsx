import { cn } from '@/shared/lib/cn'

/**
 * ТОЧКА-ПОДСКАЗКА — ОДИН ПРИМИТИВ НА ПРОДУКТ.
 *
 * Мелкий кружок «здесь есть что-то новое» писали руками трижды, и каждая копия
 * задавала размер, положение и цвет заново. Размер точки — не украшение: на 12px
 * она читается как грязь на экране, на 8px спорит с иконкой.
 *
 * ⚠️ ТОЧКА НИЧЕГО НЕ ГОВОРИТ ЭКРАННОМУ ДИКТОРУ (`aria-hidden`) — она лишь метит
 * место. Смысл обязан нести текст рядом: тултип кнопки или подпись пункта. Точка
 * без такого текста — подсказка, которой не существует для половины людей.
 */
export function HintDot({
  tone = 'warn',
  place = 'corner',
  bursting,
  className,
  ...rest
}: {
  /** `warn` — «требуется твоё действие», `accent` — «тут уже что-то есть». */
  tone?: 'warn' | 'accent'
  /** `corner` — угол иконочной кнопки (родителю нужен `relative`); `inline` — в строке. */
  place?: 'corner' | 'inline'
  /** Точка лопается и исчезает: подсказку приняли. */
  bursting?: boolean
  className?: string
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        tone === 'warn' ? 'bg-warn' : 'bg-accent',
        place === 'corner' && 'absolute right-0.5 top-0.5',
        bursting && 'animate-sf-hint-burst',
        className,
      )}
      {...rest}
    />
  )
}
