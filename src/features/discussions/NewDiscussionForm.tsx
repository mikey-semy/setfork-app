'use client'

import { useActionState } from 'react'
import type { ReactNode } from 'react'
import { createDiscussion, type DiscussionRefusal } from './actions'
import { Alert } from '@/shared/ui/Alert'

/**
 * Форма нового обсуждения: отказ на месте, набранный текст остаётся.
 *
 * Переход на `?e=empty` начинал новый GET и стирал тело вместе с заголовком — забыл
 * заголовок, потерял весь текст. Тот же корень, что у формы списка и релиза.
 */
export function NewDiscussionForm({
  children,
  emptyText,
  className,
}: {
  children: ReactNode
  emptyText: string
  className?: string
}) {
  const [refusal, action] = useActionState<DiscussionRefusal | null, FormData>(createDiscussion, null)

  return (
    <form action={action} className={className}>
      {refusal === 'empty' && (
        <Alert variant="danger" className="mb-3">
          {emptyText}
        </Alert>
      )}
      {children}
    </form>
  )
}
