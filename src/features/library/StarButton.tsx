'use client'

import { useOptimistic, useTransition } from 'react'
import { Star } from 'lucide-react'
import { Tooltip } from '@/shared/ui/Tooltip'
import { splitSegment } from '@/shared/ui/SplitButton'
import { toggleStar } from '@/features/library/actions'

/**
 * Левый сегмент сплит-кнопки звезды: сама отметка. Рамку, разделители и счётчик рисует
 * обёртка (SplitButton в StarSplit) — здесь только действие и его состояние, иначе
 * анатомия расходится с соседними сплитами (Следить/Форк).
 */
export function StarButton({
  templateId,
  starred,
  label,
  onStarredChange,
}: {
  templateId: string
  starred: boolean
  label: string
  /** Сообщить обёртке об изменении — чтобы рамка группы и счётчик обновились сразу. */
  onStarredChange?: (starred: boolean) => void
}) {
  const [pending, start] = useTransition()
  // Оптимистично: звезда закрашивается мгновенно, до ответа сервера.
  const [opt, setOpt] = useOptimistic(starred, (_s, next: boolean) => next)
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={() =>
          start(async () => {
            setOpt(!opt)
            onStarredChange?.(!opt)
            await toggleStar(templateId)
          })
        }
        disabled={pending}
        className={splitSegment({ className: `disabled:opacity-60 ${opt ? 'bg-(--accent-soft) text-warn' : 'text-ink'}` })}
      >
        <Star size={14} fill={opt ? 'currentColor' : 'none'} />
        {/* Мобила: только иконка — подпись прячем, как у соседних кнопок ряда. */}
        <span className="hidden sm:inline">{label}</span>
      </button>
    </Tooltip>
  )
}
