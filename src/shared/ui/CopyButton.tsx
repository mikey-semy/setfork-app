'use client'

import { useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { Tooltip } from './Tooltip'

/**
 * Кнопка-иконка «скопировать»: aria-label обязателен по смыслу (иконка без
 * текста — Lighthouse button-name, линза 07); подписи прокидывает вызывающий
 * на языке страницы, дефолты — EN.
 *
 * Отказ буфера НЕ проглатывается. В небезопасном контексте (http, своё
 * развёртывание) `navigator.clipboard` отсутствует, а `writeText` возвращает
 * промис — прежний `try/catch` вокруг несинхронного вызова отказ не ловил
 * вовсе. Молчаливая кнопка приводит к тому, что человек вставляет в терминал
 * прошлое содержимое буфера.
 *
 * Бокс кнопки задан явно: у иконки 14px без него тач-цель равна 14×14 при
 * норме 44×44 (Apple HIG) — на крупном указателе цель растёт до полной.
 */
export function CopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied',
  failedLabel = 'Copy failed',
}: {
  text: string
  label?: string
  copiedLabel?: string
  failedLabel?: string
}) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  const title = state === 'done' ? copiedLabel : state === 'failed' ? failedLabel : label

  const onClick = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setState('done')
    } catch {
      setState('failed')
    }
    setTimeout(() => setState('idle'), 1600)
  }

  return (
    <Tooltip label={title}>
      <button
        type="button"
        aria-label={title}
        onClick={onClick}
        className="grid size-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink pointer-coarse:size-11"
      >
        {state === 'done' ? (
          <Check size={14} className="text-ok" />
        ) : state === 'failed' ? (
          <X size={14} className="text-danger" />
        ) : (
          <Copy size={14} />
        )}
      </button>
    </Tooltip>
  )
}
