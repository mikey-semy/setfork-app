'use client'

import { useOptimistic, useTransition } from 'react'
import { Pin, PinOff } from 'lucide-react'
import { Tooltip } from '@/shared/ui/Tooltip'
import { buttonClass } from '@/shared/ui/button-style'
import { setListPinned } from './actions/list-settings'

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
      className={buttonClass({
        className: `max-sm:size-8 max-sm:px-0 ${opt ? 'border-accent bg-accent-soft text-accent hover:border-accent' : ''}`,
      })}
    >
      {opt ? <PinOff size={14} /> : <Pin size={14} />}
      <span className="hidden sm:inline">{opt ? unpinLabel : pinLabel}</span>
    </button>
    </Tooltip>
  )
}
