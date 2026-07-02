'use client'

import { useState } from 'react'
import { Check, Share2 } from 'lucide-react'

export function ShareButton({
  path,
  title,
  className,
  label,
  copiedLabel,
}: {
  path: string
  title?: string
  className?: string
  label?: string
  copiedLabel?: string
}) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      title="share"
      className={className}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const url = typeof location !== 'undefined' ? location.origin + path : path
        try {
          if (navigator.share) {
            navigator.share({ url, title }).catch(() => {})
          } else {
            navigator.clipboard?.writeText(url)
            setDone(true)
            setTimeout(() => setDone(false), 1400)
          }
        } catch {
          /* noop */
        }
      }}
    >
      {done ? <Check size={15} /> : <Share2 size={15} />}
      {label && <span>{done ? (copiedLabel ?? label) : label}</span>}
    </button>
  )
}
