'use client'

import { useState, useTransition } from 'react'
import { MessageSquare, Check, RotateCcw, Loader2 } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/button'
import { Tooltip } from '@/shared/ui/Tooltip'
import { timeAgo } from '@/shared/ui/timeAgo'
import type { Lang } from '@/shared/i18n'
import { createBlockThread, replyToBlockThread, setBlockThreadResolved } from './actions'
import type { BlockThread } from './queries'
import type { CommentField } from './fields'

export interface CommentLabels {
  add: string
  placeholder: string
  send: string
  cancel: string
  reply: string
  resolve: string
  unresolve: string
  resolved: string
  onSelection: string
  onBlock: string
  /** Три состояния якоря — показываем честно, а не молча прячем тред. */
  stateReanchored: string
  stateOrphaned: string
  orphanHint: string
}

/**
 * Комментарии к одному блоку списка: тред + ответы + разрешение.
 *
 * Выделение текста → комментарий «к части»: берём ВЫДЕЛЕННУЮ СТРОКУ, а не
 * координаты — описание рендерится Markdown'ом, и смещения в DOM не совпадают
 * с исходником. Место в исходнике находит сервер.
 */
export function BlockComments({
  owner,
  slug,
  blockId,
  field,
  threads,
  canComment,
  lang,
  labels,
}: {
  owner: string
  slug: string
  blockId: string
  field: CommentField
  threads: BlockThread[]
  canComment: boolean
  lang: Lang
  labels: CommentLabels
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [quote, setQuote] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const openComposer = () => {
    // Что пользователь выделил ПРЯМО СЕЙЧАС — цитата треда. Пусто = к блоку целиком.
    const sel = typeof window !== 'undefined' ? (window.getSelection()?.toString() ?? '') : ''
    setQuote(sel.trim().slice(0, 500))
    setReplyTo(null)
    setOpen(true)
  }

  const submit = () => {
    const body = draft.trim()
    if (!body) return
    startTransition(async () => {
      if (replyTo) await replyToBlockThread(owner, slug, replyTo, body)
      else await createBlockThread(owner, slug, blockId, field, quote, body)
      setDraft('')
      setQuote('')
      setReplyTo(null)
      setOpen(false)
    })
  }

  const visible = threads.filter((t) => !t.resolvedAt)
  const resolved = threads.filter((t) => t.resolvedAt)
  const count = threads.length

  return (
    <>
      {/* Служебная иконка — в правом верхнем углу карточки (mobile-ui: не в потоке,
          иначе при переносе заголовка уплывает в середину). */}
      {canComment && (
        <Tooltip label={labels.add}>
          <button
            type="button"
            onClick={openComposer}
            aria-label={labels.add}
            className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
          >
            <MessageSquare size={14} />
            {count > 0 && <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-accent" />}
          </button>
        </Tooltip>
      )}

      {(visible.length > 0 || resolved.length > 0 || open) && (
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-2.5">
          {visible.map((t) => (
            <ThreadCard
              key={t.id}
              thread={t}
              owner={owner}
              slug={slug}
              lang={lang}
              labels={labels}
              canComment={canComment}
              onReply={() => {
                setReplyTo(t.id)
                setQuote('')
                setOpen(true)
              }}
            />
          ))}

          {/* Разрешённые треды свёрнуты в строку-счётчик: обсуждение никуда не
              пропало, вернуть в работу можно всегда. */}
          {resolved.length > 0 && (
            <ResolvedRow owner={owner} slug={slug} resolved={resolved} labels={labels} canComment={canComment} />
          )}

          {open && (
            <div className="rounded-md border border-border bg-surface-2 p-2.5">
              {quote && (
                <div className="mb-2 border-l-2 border-accent/50 pl-2 text-[12px] text-ink-2">
                  <span className="text-muted">{labels.onSelection}: </span>
                  <span className="[overflow-wrap:anywhere]">«{quote}»</span>
                </div>
              )}
              {!quote && !replyTo && <div className="mb-2 text-[12px] text-muted">{labels.onBlock}</div>}
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={labels.placeholder}
                rows={3}
                className="w-full resize-y rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-ink outline-hidden focus-visible:border-border-strong"
              />
              {/* Действия — вправо-вниз (thumb-зона), одна высота в ряду. */}
              <div className="mt-2 flex items-center justify-end gap-2">
                <Button variant="ghost" className="h-[38px]" onClick={() => setOpen(false)} disabled={pending}>
                  {labels.cancel}
                </Button>
                <Button variant="primary" className="h-[38px]" onClick={submit} disabled={pending || !draft.trim()}>
                  {pending ? <Loader2 size={13} className="animate-spin" /> : labels.send}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

function ThreadCard({
  thread,
  owner,
  slug,
  lang,
  labels,
  canComment,
  onReply,
}: {
  thread: BlockThread
  owner: string
  slug: string
  lang: Lang
  labels: CommentLabels
  canComment: boolean
  onReply: () => void
}) {
  const [pending, startTransition] = useTransition()
  const quote = thread.anchorCurrent?.exact || thread.anchorOriginal.exact
  const orphaned = thread.anchorState === 'orphaned'
  const reanchored = thread.anchorState === 'reanchored'

  return (
    <div className={`rounded-md border p-2.5 ${orphaned ? 'border-dashed border-border bg-surface-2/60' : 'border-border bg-surface-2'}`}>
      {/* Цитата + честное состояние якоря: перепривязан — с уверенностью, потерян —
          показываем вмороженный снимок, а не прячем тред. */}
      {(quote || orphaned) && (
        <div className={`mb-1.5 border-l-2 pl-2 text-[12px] ${orphaned ? 'border-muted text-muted line-through' : 'border-accent/50 text-ink-2'}`}>
          <span className="[overflow-wrap:anywhere]">«{quote || thread.contextSnapshot.slice(0, 120)}»</span>
        </div>
      )}
      {(orphaned || reanchored) && (
        <div className="mb-1.5 text-[11.5px] text-muted">
          {orphaned ? labels.orphanHint : `${labels.stateReanchored} · ${thread.anchorConfidence ?? 0}%`}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {thread.comments.map((c) => (
          <div key={c.id} className="flex gap-2">
            <Avatar handle={c.author.handle} avatarUrl={c.author.avatarUrl} size={20} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                <span className="font-semibold text-ink">{c.author.name || c.author.handle}</span>
                <span className="text-muted">{timeAgo(c.createdAt, lang)}</span>
              </div>
              <div className="whitespace-pre-wrap text-[13px] text-ink-2 [overflow-wrap:anywhere]">{c.body}</div>
            </div>
          </div>
        ))}
      </div>

      {canComment && (
        <div className="mt-2 flex items-center justify-end gap-2">
          <Button variant="ghost" className="h-[38px]" onClick={onReply}>
            {labels.reply}
          </Button>
          <Tooltip label={labels.resolve}>
            <Button
              variant="ghost"
              className="h-[38px]"
              aria-label={labels.resolve}
              disabled={pending}
              onClick={() => startTransition(async () => void (await setBlockThreadResolved(owner, slug, thread.id, true)))}
            >
              {pending ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  )
}

/** Строка-счётчик разрешённых тредов + возврат последнего в работу. */
function ResolvedRow({
  owner,
  slug,
  resolved,
  labels,
  canComment,
}: {
  owner: string
  slug: string
  resolved: BlockThread[]
  labels: CommentLabels
  canComment: boolean
}) {
  const [pending, startTransition] = useTransition()
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
      <Check size={13} className="text-ok" />
      <span>
        {labels.resolved}: {resolved.length}
      </span>
      {canComment && (
        <Button
          variant="ghost"
          className="h-[38px]"
          disabled={pending}
          onClick={() => startTransition(async () => void (await setBlockThreadResolved(owner, slug, resolved[0].id, false)))}
        >
          <RotateCcw size={12} /> {labels.unresolve}
        </Button>
      )}
    </div>
  )
}
