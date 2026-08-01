'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Tooltip } from './Tooltip'

/**
 * Кнопка-иконка «скопировать»: aria-label обязателен по смыслу (иконка без
 * текста — Lighthouse button-name, линза 07); подписи прокидывает вызывающий
 * на языке страницы, дефолты — EN.
 */
export function CopyButton({ text, label = 'Copy', copiedLabel = 'Copied' }: { text: string; label?: string; copiedLabel?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Tooltip label={done ? copiedLabel : label}>
      <button
        type="button"
        aria-label={done ? copiedLabel : label}
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
