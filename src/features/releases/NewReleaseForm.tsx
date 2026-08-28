'use client'

import { useActionState } from 'react'
import type { ReactNode } from 'react'
import { createRelease, type ReleaseRefusal } from './actions'
import { Alert } from '@/shared/ui/Alert'
import { useKeepFormValues } from '@/shared/ui/keep-form-values'

/**
 * Форма выпуска релиза: отказ показывается НА МЕСТЕ, введённое остаётся.
 *
 * Отказ уносил переходом на `?e=…`, то есть новым GET, и форма стиралась. В ней самое
 * дорогое — заметки релиза: человек мог только что их СГЕНЕРИРОВАТЬ, а это вызов ИИ,
 * то есть деньги и минуты ожидания. Ошибся в теге — плати ещё раз.
 *
 * Тексты приходят готовыми строками: словарь живёт на сервере, сюда нужен только код
 * отказа и подпись к нему.
 */
export function NewReleaseForm({
  templateId,
  children,
  texts,
  className,
}: {
  templateId: string
  children: ReactNode
  /** Код отказа → подпись. Собирается на сервере ИЗ ТОГО ЖЕ словаря, что и раньше. */
  texts: Record<ReleaseRefusal, string>
  className?: string
}) {
  const [refusal, action] = useActionState<ReleaseRefusal | null, FormData>(
    createRelease.bind(null, templateId),
    null,
  )
  // Набранное переживает отказ: форма React сбрасывает неуправляемые поля сама.
  const { formRef, onSubmit } = useKeepFormValues(refusal !== null)

  return (
    <form ref={formRef} onSubmit={onSubmit} action={action} className={className}>
      {refusal && (
        <Alert variant="danger" className="mb-4">
          {texts[refusal]}
        </Alert>
      )}
      {children}
    </form>
  )
}
