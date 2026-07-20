'use client'

import { useTransition } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { Tooltip } from '@/shared/ui/Tooltip'
import { deleteRun } from './actions'

/** Кнопка «удалить прогон» (с подтверждением). Отдельный элемент — не вложен в Link карточки. */
export function DeleteRunButton({ runId, confirmText, label }: { runId: string; confirmText: string; label: string }) {
  const [pending, start] = useTransition()
  return (
    <Tooltip label={label}>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm(confirmText)) start(() => deleteRun(runId))
        }}
        aria-label={label}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:text-danger disabled:opacity-50"
      >
        {pending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
      </button>
    </Tooltip>
  )
}
