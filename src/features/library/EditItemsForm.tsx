'use client'

import { useActionState } from 'react'
import type { ReactNode } from 'react'
import { updateSuggestionItems, type EditItemsRefusal } from '@/features/library/actions'
import { Alert } from '@/shared/ui/Alert'
import { useKeepFormValues } from '@/shared/ui/keep-form-values'

/**
 * Форма правки своего предложения: отказ на месте, набранное остаётся.
 *
 * Три отказа здесь раньше просто ВОЗВРАЩАЛИСЬ — предложение успели закрыть, право
 * отозвали, список заморозили. Человек жал «Сохранить» и не получал ничего. Причём
 * первые два означают «пока ты правил, снаружи что-то изменилось» — случай, где
 * молчание хуже всего: правка цела, а почему не сохранилась, неизвестно.
 */
export function EditItemsForm({
  suggestionId,
  children,
  texts,
}: {
  suggestionId: string
  children: ReactNode
  /** Известные коды → подписи; незнакомый код (отказ записи) показывается как есть. */
  texts: Record<string, string>
}) {
  const [refusal, action, pending] = useActionState<EditItemsRefusal | null, FormData>(
    updateSuggestionItems.bind(null, suggestionId),
    null,
  )
  const { formRef, onSubmit } = useKeepFormValues(refusal !== null, pending)

  return (
    <form ref={formRef} onSubmit={onSubmit} action={action}>
      {refusal && (
        <Alert variant="danger" className="mb-4">
          {texts[refusal] ?? refusal}
        </Alert>
      )}
      {children}
    </form>
  )
}
