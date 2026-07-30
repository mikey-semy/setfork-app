'use client'

import { useOptimistic, useTransition } from 'react'
import { Star } from 'lucide-react'
import { Tooltip } from '@/shared/ui/Tooltip'
import { toggleStar } from '@/features/library/actions'

export function StarButton({
  templateId,
  starred,
  count,
  label,
  grouped = false, // правая половина — дропдаун папок (split-кнопка как у GitHub)
  bare = false, // рамку рисует обёртка группы (StarSplit) — по всему периметру
  onStarredChange,
}: {
  templateId: string
  starred: boolean
  count: number
  label: string
  grouped?: boolean
  bare?: boolean
  /** Сообщить обёртке об изменении — чтобы рамка группы перекрасилась сразу. */
  onStarredChange?: (starred: boolean) => void
}) {
  const [pending, start] = useTransition()
  // Оптимистично: галочка и счётчик меняются мгновенно, до ответа сервера.
  const [opt, setOpt] = useOptimistic({ starred, count }, (s, next: boolean) => ({
    starred: next,
    count: Math.max(0, s.count + (next ? 1 : -1)),
  }))
  return (
    <Tooltip label={label}>
    <button
      onClick={() =>
        start(async () => {
          setOpt(!opt.starred)
          onStarredChange?.(!opt.starred)
          await toggleStar(templateId)
        })
      }
      disabled={pending}
      // Без подписи и без счётчика (на мобиле при нуле) кнопка — квадрат 36×36,
      // как остальные иконочные кнопки шапки.
      className={`inline-flex h-9 items-center gap-2 pl-3.5 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
        bare ? '' : `border ${grouped ? 'rounded-l-md' : 'rounded-md'}`
      } ${opt.count > 0 ? '' : 'pr-3.5 max-sm:w-9 max-sm:justify-center max-sm:px-0'} ${
        opt.starred
          ? `bg-(--accent-soft) text-warn ${bare ? '' : 'border-warn'}`
          : `text-ink ${bare ? '' : 'border-border hover:border-border-strong'}`
      }`}
    >
      <Star size={14} fill={opt.starred ? 'currentColor' : 'none'} />
      <span className="hidden sm:inline">{label}</span>
      {/* Ноль не показываем совсем (нечего сообщать), а число — за разделителем,
          как счётчик у форка: одна манера у всех кнопок шапки. */}
      {opt.count > 0 && (
        <span className="flex h-full items-center self-stretch border-l border-border px-2.5 font-mono text-[12px] text-muted">
          {opt.count}
        </span>
      )}
    </button>
    </Tooltip>
  )
}
