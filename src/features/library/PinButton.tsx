'use client'

import { useOptimistic, useTransition } from 'react'
import { Pin, PinOff } from 'lucide-react'
import { setListPinned } from './actions'

/** Pin/Unpin списка на профиль владельца (как Pin у GitHub-репозитория). Показывается
 *  только своим ПУБЛИЧНЫМ спискам — приватные к публичному профилю не прикрепляем. */
export function PinButton({
  templateId,
  pinned,
  pinLabel,
  unpinLabel,
}: {
  templateId: string
  pinned: boolean
  pinLabel: string
  unpinLabel: string
}) {
  const [pending, start] = useTransition()
  const [opt, setOpt] = useOptimistic(pinned, (_, next: boolean) => next)

  return (
    <button
      onClick={() =>
        start(async () => {
          setOpt(!opt)
          await setListPinned(templateId, !opt)
        })
      }
      disabled={pending}
      aria-label={opt ? unpinLabel : pinLabel}
      title={opt ? unpinLabel : pinLabel}
      className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:opacity-60 max-sm:px-2.5 max-sm:py-1.5 ${
        opt ? 'border-accent bg-(--accent-soft) text-accent' : 'border-border text-ink hover:border-border-strong'
      }`}
    >
      {opt ? <PinOff size={14} /> : <Pin size={14} />}
      <span className="hidden sm:inline">{opt ? unpinLabel : pinLabel}</span>
    </button>
  )
}
