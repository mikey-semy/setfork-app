'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Tooltip } from '@/shared/ui/Tooltip'
import { editSuggestionNote } from './actions'
import { Spinner } from '@/shared/ui/Spinner'
import { IconButton } from '@/shared/ui/IconButton'
import { Input } from '@/shared/ui/input'

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
        <Input value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={labels.placeholder}
          maxLength={300} className="min-w-0 flex-1" />
        {/* Действия — вправо, одной высотой (стандарт кнопок). */}
        <Button variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
          {labels.cancel}
        </Button>
        <Button variant="primary" onClick={save} disabled={pending || !draft.trim()}>
          {pending ? <Spinner size="sm" /> : labels.save}
        </Button>
      </div>
    )
  }

  return (
    <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
      <h1 className="min-w-0 text-heading font-bold leading-tight text-ink [overflow-wrap:anywhere]">{note}</h1>
      {number != null && (
        <Link href={path} className="text-heading font-normal text-muted hover:text-accent">
          #{number}
        </Link>
      )}
      {canEdit && (
        <Tooltip label={labels.edit}>
          <IconButton variant="ghost" label={labels.edit} className="text-muted hover:bg-surface-2 hover:text-ink" onClick={() => setEditing(true)}>
            <Pencil size={14} />
          </IconButton>
        </Tooltip>
      )}
    </div>
  )
}
