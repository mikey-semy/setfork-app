'use client'

import { useActionState } from 'react'
import { t, type Lang } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { UserHandleInput } from '@/shared/ui/UserHandleInput'
import { addCollaborator, type AddCollaboratorResult } from './actions'

const ERROR_KEY = {
  empty: 'addCollaboratorEmpty',
  notFound: 'addCollaboratorNotFound',
  owner: 'addCollaboratorOwner',
  forbidden: 'addCollaboratorForbidden',
} as const

/** Форма «добавить соавтора»: отказ называет причину под полем и оставляет набранный
 *  ник, успех — короткое подтверждение (раньше оба исхода выглядели одинаково — никак). */
export function AddCollaboratorForm({ templateId, lang }: { templateId: string; lang: Lang }) {
  const [state, action, pending] = useActionState<AddCollaboratorResult | null, FormData>(
    addCollaborator.bind(null, templateId),
    null,
  )
  return (
    <form action={action} className="mb-3 flex flex-col gap-1.5">
      {/* Поле и кнопка в одном ряду без переноса: на телефоне поле ужимается (flex-1 +
          min-w-0 внутри), на широком экране — ширина меню, чтобы не тянуться на всю секцию. */}
      <div className="flex items-center gap-2">
        <UserHandleInput
          // Новый отказ — новое поле с вернувшимся ником: у неуправляемого поля
          // defaultValue читается только при монтировании.
          key={state?.error ? `${state.error}:${state.handle ?? ''}` : 'fresh'}
          name="handle"
          defaultValue={state?.handle}
          placeholder={t('addCollaboratorPh', lang)}
          aria-label={t('addCollaboratorPh', lang)}
          aria-invalid={!!state?.error}
          className="flex-1 sm:w-menu sm:flex-none"
        />
        <Button type="submit" variant="primary" size="md" className="shrink-0" disabled={pending}>
          {t('addCollaborator', lang)}
        </Button>
      </div>
      {state?.error && (
        <p role="alert" className="text-body-sm text-danger">
          {t(ERROR_KEY[state.error], lang)}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-body-sm text-ok">
          {t('addCollaboratorAdded', lang)}
        </p>
      )}
    </form>
  )
}
