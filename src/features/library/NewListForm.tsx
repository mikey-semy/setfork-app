'use client'

import { useActionState } from 'react'
import type { ReactNode } from 'react'
import { createTemplate, type NewListRefusal } from '@/features/library/actions'
import { Alert } from '@/shared/ui/Alert'
import { useKeepFormValues } from '@/shared/ui/keep-form-values'

/**
 * Форма создания списка: отказ показывается НА МЕСТЕ, введённое остаётся.
 *
 * До этого отказ уносил переходом на `/new?e=…`, то есть новым GET, — и человек терял
 * не повод для отказа, а весь набранный список: название, описание, теги и все пункты
 * редактора. Цена ошибки «адрес занят» была «набери заново» (авто-ревью #829).
 *
 * `useActionState` возвращает отказ ЗНАЧЕНИЕМ: страница не перерисовывается, состояние
 * редактора живёт дальше. Без JS форма всё равно отправляется — Next дорисовывает
 * страницу с тем же состоянием, поэтому нативный путь не ломается.
 *
 * Тексты приходят готовыми строками с сервера: словарь живёт там, а сюда нужен только
 * шаблон с местом для подстановки.
 */
export function NewListForm({
  children,
  texts,
}: {
  children: ReactNode
  texts: {
    slugTakenTitle: string
    /** `{slug}` — занятый адрес. */
    slugTakenBody: string
    blockedTitle: string
    /** `{n}` — номер шага, `{reason}` — причина словами. */
    blockedBody: string
    /** Причины стража исполняемых команд: код → слова. */
    blockedReasons: Record<string, string>
    /** `{n}` — предел числа списков. */
    quotaReached: string
    noTitle: string
  }
}) {
  const [refusal, action, pending] = useActionState<NewListRefusal | null, FormData>(createTemplate, null)
  // Набранное переживает отказ: форма React сбрасывает неуправляемые поля сама.
  const { formRef, onSubmit } = useKeepFormValues(refusal !== null, pending)

  return (
    <form ref={formRef} onSubmit={onSubmit} action={action}>
      {refusal?.kind === 'slug_taken' && (
        <Alert variant="danger" className="mb-5">
          <span className="block font-semibold">{texts.slugTakenTitle}</span>
          <span className="block">{texts.slugTakenBody.replace('{slug}', refusal.slug)}</span>
        </Alert>
      )}

      {refusal?.kind === 'blocked' && (
        <Alert variant="danger" className="mb-5">
          <span className="block font-semibold">{texts.blockedTitle}</span>
          <span className="block">
            {texts.blockedBody
              .replace('{n}', String(refusal.step))
              .replace('{reason}', texts.blockedReasons[refusal.reason] ?? refusal.reason)}
          </span>
        </Alert>
      )}

      {refusal?.kind === 'list_quota' && (
        <Alert variant="warn" className="mb-5">
          {texts.quotaReached.replace('{n}', String(refusal.limit))}
        </Alert>
      )}

      {refusal?.kind === 'no_title' && (
        <Alert variant="danger" className="mb-5">
          {texts.noTitle}
        </Alert>
      )}

      {children}
    </form>
  )
}
