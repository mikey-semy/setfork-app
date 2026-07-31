'use client'

import { Star } from 'lucide-react'
import { Tooltip } from '@/shared/ui/Tooltip'
import { splitSegment } from '@/shared/ui/split-segment'

/**
 * Левый сегмент сплит-кнопки звезды: сама отметка.
 *
 * Ни рамки, ни счётчика, ни собственного состояния: всё это — забота обёртки (StarSplit),
 * иначе оптимистичное состояние живёт в двух местах и откатывается наполовину, а
 * анатомия расходится с соседними сплитами (Следить/Форк).
 */
export function StarButton({
  starred,
  pending,
  label,
  onToggle,
}: {
  starred: boolean
  pending: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        aria-pressed={starred}
        className={splitSegment({ className: `disabled:opacity-60 ${starred ? 'bg-(--accent-soft) text-warn' : 'text-ink'}` })}
      >
        <Star size={14} fill={starred ? 'currentColor' : 'none'} />
        {/* Мобила: только иконка — подпись прячем, как у соседних кнопок ряда. */}
        <span className="hidden sm:inline">{label}</span>
      </button>
    </Tooltip>
  )
}
