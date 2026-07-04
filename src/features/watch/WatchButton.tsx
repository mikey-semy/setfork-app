'use client'

import { useOptimistic, useTransition } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { toggleWatch } from './actions'

export function WatchButton({
  templateId,
  watching,
  count,
  watchLabel,
  unwatchLabel,
}: {
  templateId: string
  watching: boolean
  count: number
  watchLabel: string
  unwatchLabel: string
}) {
  const [pending, start] = useTransition()
  const [opt, setOpt] = useOptimistic({ watching, count }, (s, next: boolean) => ({
    watching: next,
    count: Math.max(0, s.count + (next ? 1 : -1)),
  }))
  return (
    <button
      onClick={() =>
        start(async () => {
          setOpt(!opt.watching)
          await toggleWatch(templateId)
        })
      }
      disabled={pending}
      className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
        opt.watching ? 'border-accent bg-[var(--accent-soft)] text-accent' : 'border-border text-ink hover:border-border-strong'
      }`}
    >
      {opt.watching ? <EyeOff size={14} /> : <Eye size={14} />}
      <span className="hidden sm:inline">{opt.watching ? unwatchLabel : watchLabel}</span>
      <span className="font-mono text-[12px] text-muted">{opt.count}</span>
    </button>
  )
}
