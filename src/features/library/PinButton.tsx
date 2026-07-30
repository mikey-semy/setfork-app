'use client'

import { useOptimistic, useTransition } from 'react'
import { Pin, PinOff } from 'lucide-react'
import { Tooltip } from '@/shared/ui/Tooltip'
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
    // Свой Tooltip вместо браузерного title=: одна манера подсказок на всё приложение.
    <Tooltip label={opt ? unpinLabel : pinLabel}>
    <button
      type="button"
      onClick={() =>
        start(async () => {
          setOpt(!opt)
          await setListPinned(templateId, !opt)
        })
      }
      disabled={pending}
      aria-label={opt ? unpinLabel : pinLabel}
      // На мобиле подписи нет — кнопка становится квадратом 36×36, как остальные
      // иконочные кнопки шапки (владелец: «сделай их примерно одинаковой ширины»).
      className={`inline-flex h-9 items-center gap-2 rounded-md border px-3.5 text-[13px] font-semibold transition-colors disabled:opacity-60 max-sm:w-9 max-sm:justify-center max-sm:px-0 ${
        opt ? 'border-accent bg-(--accent-soft) text-accent' : 'border-border text-ink hover:border-border-strong'
      }`}
    >
      {opt ? <PinOff size={14} /> : <Pin size={14} />}
      <span className="hidden sm:inline">{opt ? unpinLabel : pinLabel}</span>
    </button>
    </Tooltip>
  )
}
