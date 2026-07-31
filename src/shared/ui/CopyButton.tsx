'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Tooltip } from './Tooltip'

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <Tooltip label={done ? 'Copied' : 'Copy'}>
      <button
        type="button"
        onClick={() => {
          try {
            navigator.clipboard?.writeText(text)
            setDone(true)
            setTimeout(() => setDone(false), 1200)
          } catch {
            /* noop */
          }
        }}
        className="shrink-0 text-muted hover:text-ink"
      >
        {done ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </Tooltip>
  )
}
