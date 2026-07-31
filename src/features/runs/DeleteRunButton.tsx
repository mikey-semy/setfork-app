'use client'

import { useTransition } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { Tooltip } from '@/shared/ui/Tooltip'
import { useConfirm } from '@/shared/ui/use-confirm'
import { t, type Lang } from '@/shared/i18n'
import { deleteRun } from './actions'

/** Кнопка «удалить прогон» (с подтверждением). Отдельный элемент — не вложен в Link карточки. */
export function DeleteRunButton({ runId, confirmText, label, lang }: { runId: string; confirmText: string; label: string; lang: Lang }) {
  const [pending, start] = useTransition()
  const { confirm, confirmDialog } = useConfirm()
  return (
    <>
      <Tooltip label={label}>
        <button
          type="button"
          disabled={pending}
          onClick={async () => {
            const ok = await confirm({ title: label, intro: confirmText, confirmLabel: label, cancelLabel: t('cancel', lang) })
            if (ok) start(() => deleteRun(runId))
          }}
          aria-label={label}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:text-danger disabled:opacity-50"
        >
          {pending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
        </button>
      </Tooltip>
      {confirmDialog}
    </>
  )
}
