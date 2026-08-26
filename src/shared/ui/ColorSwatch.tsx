import { cn } from '@/shared/lib/cn'
import { TOUCH_MIN_BOX } from './control'

/**
 * Кружок цвета в палитре: акцент списка, цвет метки задачи.
 *
 * Заведён 26.08.2026 по замеру `scripts/ui-parity.mjs`: рецепт жил двумя копиями —
 * палитра акцента обложки и палитра цвета метки, — и копии уже разошлись. Одна умела
 * вариант «без цвета» (крестик), другая нет; обе объявляли высоту руками (20px мимо
 * шкалы) и обе оставались 20-пиксельной целью на пальце, то есть вдвое меньше
 * минимума (44pt у Apple HIG, 48dp у Material).
 *
 * Почему не `IconButton`: у кнопки вид задаёт вариант темы, а здесь вид — это САМ
 * ЦВЕТ, приходящий данными. Общее у них только поведение цели, и оно берётся из
 * одного места — `TOUCH_MIN_BOX` (соседи по палитре стоят сбоку, поэтому цель обязана
 * дорасти по обеим сторонам, а не только вверх-вниз).
 */
export function ColorSwatch({
  color,
  selected,
  label,
  onSelect,
  className,
}: {
  /** `null` — вариант «без цвета»: кружок подложки с крестиком. */
  color: string | null
  selected: boolean
  label: string
  onSelect: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-pressed={selected}
      style={color ? { backgroundColor: color } : undefined}
      className={cn(
        // inline-flex с центрированием — иначе `×` садится на БАЗОВУЮ ЛИНИЮ текста и
        // падает к низу кружка: у кнопки текст выравнен по базовой линии, а не по центру
        // бокса. Ни размером шрифта, ни line-height это не лечится — нужен флекс-центр.
        'inline-flex size-5 shrink-0 items-center justify-center rounded-full border',
        TOUCH_MIN_BOX,
        color ? 'border-black/10' : 'border-black/10 bg-surface-2',
        selected && 'ring-2 ring-(--accent) ring-offset-1',
        className,
      )}
    >
      {!color && <span className="text-[0.6875rem] leading-none text-muted">×</span>}
    </button>
  )
}
