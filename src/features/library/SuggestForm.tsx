'use client'

import { useActionState } from 'react'
import type { ReactNode } from 'react'
import { submitSuggestion, type SuggestRefusal } from '@/features/library/actions'
import { Alert } from '@/shared/ui/Alert'
import { useKeepFormValues } from '@/shared/ui/keep-form-values'

/**
 * Форма правки чужого списка: отказ показывается НА МЕСТЕ, правка остаётся.
 *
 * Страница `/suggest` — редактор со всеми пунктами списка плюс заметка; человек
 * приходит сюда работать. Переход на `?e=…` уносил всю набранную правку, и обиднее
 * всего на отказах, где сама правка ни при чём: «предложения закрыты» и «слишком
 * часто». Тот же приём, что у формы создания списка и формы релиза.
 */
export function SuggestForm({
  templateId,
  children,
  texts,
}: {
  templateId: string
  children: ReactNode
  /** Код отказа → подпись. Собирается на сервере из общего словаря. */
  texts: Record<SuggestRefusal, string>
}) {
  const [refusal, action, pending] = useActionState<SuggestRefusal | null, FormData>(
    submitSuggestion.bind(null, templateId),
    null,
  )
  // Набранное переживает отказ: форма React сбрасывает неуправляемые поля сама.
  const { formRef, onSubmit } = useKeepFormValues(refusal !== null, pending)

  return (
    <form ref={formRef} onSubmit={onSubmit} action={action}>
      {refusal && (
        <Alert variant="danger" className="mb-4">
          {texts[refusal]}
        </Alert>
      )}
      {children}
    </form>
  )
}
