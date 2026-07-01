'use client'

import { useTransition } from 'react'
import { Heart } from 'lucide-react'
import { toggleLike } from '@/features/library/actions'

export function LikeButton({
  templateId,
  liked,
  count,
  label,
}: {
  templateId: string
  liked: boolean
  count: number
  label: string
}) {
  const [pending, start] = useTransition()
  return (
    <button
      onClick={() => start(() => toggleLike(templateId))}
      disabled={pending}
      className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
        liked
          ? 'border-[var(--danger)] bg-[var(--accent-soft)] text-[var(--danger)]'
          : 'border-border text-ink hover:border-border-strong'
      }`}
    >
      <Heart size={14} fill={liked ? 'currentColor' : 'none'} /> {label}
      <span className="font-mono text-[12px] text-muted">{count}</span>
    </button>
  )
}
