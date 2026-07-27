'use client'

import { useState, useTransition } from 'react'
import { MoreHorizontal, Link2, Copy, Quote, Pencil, Loader2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { MarkdownEditor } from '@/shared/ui/MarkdownEditor'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
// eslint-disable-next-line boundaries/dependencies -- правка комментария предложения живёт в library
import { editSuggestionComment } from '@/features/library/actions'

export interface CommentActionLabels {
  more: string
  copyLink: string
  copyMarkdown: string
  quoteReply: string
  edit: string
  save: string
  cancel: string
}

/**
 * Меню действий у комментария («...» как в GitHub): ссылка, markdown, ответ
 * цитатой, правка своего.
 *
 * Отдельный клиентский компонент, а CommentCard остаётся серверным — меню
 * приходит слотом. Так карточка одна на задачи и на правки, а интерактив не
 * тянет за собой всю карточку в клиент.
 */
export function CommentActions({
  commentId,
  body,
  path,
  canEdit,
  labels,
  lang,
}: {
  commentId: string
  body: string
  /** Путь страницы — из него собирается постоянная ссылка на комментарий. */
  path: string
  canEdit: boolean
  labels: CommentActionLabels
  lang: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(body)
  const [pending, startTransition] = useTransition()

  const anchor = `#comment-${commentId}`
  const copy = (text: string) => void navigator.clipboard?.writeText(text)

  /**
   * Ответ цитатой: подставляем текст в композер страницы. Композер —
   * серверная форма с одной textarea[name=body], поэтому пишем прямо в неё:
   * заводить общий стор ради одной подстановки — лишняя машинерия.
   */
  const quote = () => {
    const quoted = body.split('\n').map((l) => `> ${l}`).join('\n')
    const ta = document.querySelector<HTMLTextAreaElement>('textarea[name="body"]')
    if (!ta) return
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    const next = (ta.value ? `${ta.value}\n\n` : '') + quoted + '\n\n'
    setter?.call(ta, next)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.focus()
    ta.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const save = () =>
    startTransition(async () => {
      const res = await editSuggestionComment(commentId, draft)
      if (res.ok) setEditing(false)
    })

  if (editing) {
    return (
      <div className="mt-2">
        <MarkdownEditor name="editBody" defaultValue={body} rows={4} lang={lang} onValueChange={setDraft} />
        <div className="mt-2 flex items-center justify-end gap-2">
          <Button variant="ghost" className="h-[38px]" onClick={() => setEditing(false)} disabled={pending}>
            {labels.cancel}
          </Button>
          <Button variant="primary" className="h-[38px]" onClick={save} disabled={pending || !draft.trim()}>
            {pending ? <Loader2 size={13} className="animate-spin" /> : labels.save}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={labels.more}
          className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
        >
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => copy(`${window.location.origin}${path}${anchor}`)}>
          <Link2 size={13} /> {labels.copyLink}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => copy(body)}>
          <Copy size={13} /> {labels.copyMarkdown}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={quote}>
          <Quote size={13} /> {labels.quoteReply}
        </DropdownMenuItem>
        {canEdit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <Pencil size={13} /> {labels.edit}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
