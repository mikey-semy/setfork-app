'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Pencil, Loader2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Tooltip } from '@/shared/ui/Tooltip'
import { editSuggestionNote } from './actions'

export interface TitleLabels {
  edit: string
  save: string
  cancel: string
  placeholder: string
}

/**
 * Заголовок правки с номером и правкой на месте (как заголовок PR в GitHub).
 *
 * Номер — ссылка на саму страницу: так его удобно копировать и им ссылаться.
 * Кнопка правки — служебная, поэтому иконкой и только тем, кто вправе править
 * (автор или владелец списка); остальным заголовок просто читается.
 */
export function SuggestionTitle({
  note,
  number,
  path,
  suggestionId,
  canEdit,
  labels,
}: {
  note: string
  number: number | null
  path: string
  suggestionId: string
  canEdit: boolean
  labels: TitleLabels
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note)
  const [pending, start] = useTransition()

  const save = () =>
    start(async () => {
      const res = await editSuggestionNote(suggestionId, draft)
      if (res.ok) setEditing(false)
    })

  if (editing) {
    return (
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={labels.placeholder}
          maxLength={300}
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[1rem] text-ink outline-hidden focus-visible:border-border-strong"
        />
        {/* Действия — вправо, одной высотой (стандарт кнопок). */}
        <Button variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
          {labels.cancel}
        </Button>
        <Button variant="primary" onClick={save} disabled={pending || !draft.trim()}>
          {pending ? <Loader2 size={13} className="animate-spin" /> : labels.save}
        </Button>
      </div>
    )
  }

  return (
    <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
      <h1 className="min-w-0 text-[1.25rem] font-bold leading-tight text-ink [overflow-wrap:anywhere]">{note}</h1>
      {number != null && (
        <Link href={path} className="text-[1.25rem] font-normal text-muted hover:text-accent">
          #{number}
        </Link>
      )}
      {canEdit && (
        <Tooltip label={labels.edit}>
          <button
            type="button"
            aria-label={labels.edit}
            onClick={() => setEditing(true)}
            className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
          >
            <Pencil size={14} />
          </button>
        </Tooltip>
      )}
    </div>
  )
}
