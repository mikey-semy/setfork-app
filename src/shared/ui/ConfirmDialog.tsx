'use client'

import { useId, useState, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { OverlayPanel } from './OverlayPanel'
import { Button } from './button'
import { CopyRow } from './CopyRow'
import { confirmMatches } from '@/shared/lib/confirm-phrase'
import { buttonClass } from '@/shared/ui/button-style'

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
  const formId = useId()
  const [typed, setTyped] = useState('')
  const matched = confirmPhrase ? confirmMatches(typed, confirmPhrase) : true
  const disabled = !matched || busy

  const body = (
    <div className="flex flex-col gap-4">
      {intro && <div className="text-[0.8125rem] leading-relaxed text-ink-2">{intro}</div>}
      {confirmPhrase && (
        <div className="flex flex-col gap-1.5 text-[0.78125rem] font-semibold text-ink-2">
          <span>{confirmHint}</span>
          {/* Фразу-подтверждение на мобиле выделить нельзя — даём отдельную строку
              с кнопкой «копировать» (горизонтальный скролл внутри бокса, не страницы). */}
          <CopyRow value={confirmPhrase} />
          <input
            name="confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label={typeof confirmHint === 'string' ? confirmHint : 'confirm'}
            className={buttonClass({ variant: 'danger', className: 'mt-0.5 w-full bg-surface-2 font-mono outline-hidden focus:border-danger' })}
          />
        </div>
      )}
      {error && <div className="text-[0.8125rem] text-danger">{error}</div>}
    </div>
  )

  // Кнопки живут в футере окна — общей полосе с линией во всю ширину. В режиме
  // серверного экшена они оказываются ВНЕ формы, поэтому submit связан с ней
  // атрибутом `form` (штатный приём HTML), а не переносом формы наружу.
  const actions = (
    <>
      <Button variant="ghost" onClick={onClose}>
        {cancelLabel}
      </Button>
      <Button
        type={formAction ? 'submit' : 'button'}
        form={formAction ? formId : undefined}
        variant="dangerSolid"
        disabled={disabled}
        onClick={formAction ? undefined : onConfirm}
      >
        {confirmLabel}
      </Button>
    </>
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
      footer={actions}
    >
      {formAction ? (
        <form id={formId} action={formAction}>
          {hiddenFields}
          {body}
        </form>
      ) : (
        body
      )}
    </OverlayPanel>
  )
}
