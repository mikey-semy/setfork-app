'use client'

import { useState, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { OverlayPanel } from './OverlayPanel'
import { Button } from './button'
import { confirmMatches } from '@/shared/lib/confirm-phrase'

// Общая модалка подтверждения опасного действия (type-to-confirm, как GitHub
// «To confirm, type owner/repo»). Заменяет два инлайн-дубля (список/аккаунт).
// Два режима запуска действия:
//  - onConfirm: клиентский экшен через useTransition (delete/visibility списка);
//  - formAction: серверный экшен формой (deleteAccount с useActionState —
//    сервер повторно сверяет поле confirm). Введённое значение уходит как
//    поле name="confirm".
export function ConfirmDialog({
  open,
  onClose,
  title,
  intro,
  confirmPhrase,
  confirmHint,
  confirmLabel,
  busy = false,
  error,
  onConfirm,
  formAction,
  hiddenFields,
  cancelLabel = 'Cancel',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** Последствия действия (список эффектов) — над полем подтверждения. */
  intro?: ReactNode
  /** Что нужно ввести дословно; пусто/undefined — без ввода (простое «Понимаю»). */
  confirmPhrase?: string
  /** Подпись над полем, напр. «Для подтверждения введите:». */
  confirmHint?: ReactNode
  confirmLabel: string
  busy?: boolean
  error?: string
  /** Клиентский режим: вызывается при подтверждении (кнопка активна при совпадении). */
  onConfirm?: () => void
  /** Серверный режим: экшен формы (введённое уходит как name="confirm"). */
  formAction?: (formData: FormData) => void
  /** Доп. скрытые поля для formAction-режима. */
  hiddenFields?: ReactNode
  cancelLabel?: string
}) {
  const [typed, setTyped] = useState('')
  const matched = confirmPhrase ? confirmMatches(typed, confirmPhrase) : true
  const disabled = !matched || busy

  const body = (
    <div className="flex flex-col gap-4 p-4">
      {intro && <div className="text-[13px] leading-relaxed text-ink-2">{intro}</div>}
      {confirmPhrase && (
        <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-ink-2">
          <span>
            {confirmHint} <span className="font-mono text-ink">{confirmPhrase}</span>
          </span>
          <input
            name="confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label={typeof confirmHint === 'string' ? confirmHint : 'confirm'}
            className="mt-0.5 w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[13px] text-ink outline-hidden focus:border-danger"
          />
        </label>
      )}
      {error && <div className="text-[13px] text-danger">{error}</div>}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-[13px] text-ink-2 hover:text-ink">
          {cancelLabel}
        </button>
        <Button
          type={formAction ? 'submit' : 'button'}
          variant="dangerSolid"
          size="md"
          disabled={disabled}
          onClick={formAction ? undefined : onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  )

  return (
    <OverlayPanel
      open={open}
      onClose={onClose}
      width={460}
      title={
        <span className="inline-flex items-center gap-1.5 text-danger">
          <TriangleAlert size={14} /> {title}
        </span>
      }
    >
      {formAction ? (
        <form action={formAction}>
          {hiddenFields}
          {body}
        </form>
      ) : (
        body
      )}
    </OverlayPanel>
  )
}
