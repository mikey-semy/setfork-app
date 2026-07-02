'use client'

import { useTransition } from 'react'
import { Star } from 'lucide-react'
import { toggleStar } from '@/features/library/actions'

export function StarButton({
  templateId,
  starred,
  count,
  label,
}: {
  templateId: string
  starred: boolean
  count: number
  label: string
}) {
  const [pending, start] = useTransition()
  return (
    <button
      onClick={() => start(() => toggleStar(templateId))}
      disabled={pending}
      className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
        starred
          ? 'border-warn bg-[var(--accent-soft)] text-warn'
          : 'border-border text-ink hover:border-border-strong'
      }`}
    >
      <Star size={14} fill={starred ? 'currentColor' : 'none'} /> {label}
      <span className="font-mono text-[12px] text-muted">{count}</span>
    </button>
  )
}
