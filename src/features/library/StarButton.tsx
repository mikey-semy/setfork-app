'use client'

import { useOptimistic, useTransition } from 'react'
import { Star } from 'lucide-react'
import { toggleStar } from '@/features/library/actions'

export function StarButton({
  templateId,
  starred,
  count,
  label,
  grouped = false, // правая половина — дропдаун папок (split-кнопка как у GitHub)
}: {
  templateId: string
  starred: boolean
  count: number
  label: string
  grouped?: boolean
}) {
  const [pending, start] = useTransition()
  // Оптимистично: галочка и счётчик меняются мгновенно, до ответа сервера.
  const [opt, setOpt] = useOptimistic({ starred, count }, (s, next: boolean) => ({
    starred: next,
    count: Math.max(0, s.count + (next ? 1 : -1)),
  }))
  return (
    <button
      onClick={() =>
        start(async () => {
          setOpt(!opt.starred)
          await toggleStar(templateId)
        })
      }
      disabled={pending}
      className={`inline-flex h-9 items-center gap-2 ${grouped ? 'rounded-l-md' : 'rounded-md'} border px-3.5 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
        opt.starred
          ? 'border-warn bg-(--accent-soft) text-warn'
          : 'border-border text-ink hover:border-border-strong'
      }`}
    >
      <Star size={14} fill={opt.starred ? 'currentColor' : 'none'} />
      <span className="hidden sm:inline">{label}</span>
      <span className="font-mono text-[12px] text-muted">{opt.count}</span>
    </button>
  )
}
