'use client'

import { useState, useTransition } from 'react'
import { Check, MessageSquare, GitPullRequestClosed, Loader2, X, ShieldOff } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { Textarea } from '@/shared/ui/textarea'
import { timeAgo } from '@/shared/ui/timeAgo'
import type { Lang } from '@/shared/i18n'
import { dismissSuggestionReview, submitSuggestionReview, withdrawSuggestionReview } from './review-actions'
import type { ReviewView, Verdict } from './review-model'

export interface ReviewLabels {
  title: string
  approve: string
  requestChanges: string
  commentOnly: string
  placeholder: string
  send: string
  withdraw: string
  blocked: string
  yourReview: string
  ownAuthor: string
  dismiss: string
  dismissReason: string
  dismissedBy: string
}

const VERDICT_META: Record<Verdict, { key: keyof ReviewLabels; cls: string; icon: typeof Check }> = {
  approve: { key: 'approve', cls: 'text-ok', icon: Check },
  changes: { key: 'requestChanges', cls: 'text-danger', icon: GitPullRequestClosed },
  comment: { key: 'commentOnly', cls: 'text-ink-2', icon: MessageSquare },
}

/**
 * Ревью правки: вердикты рецензентов + форма своего вердикта.
 *
 * Вердикт один на рецензента и перезаписывается — поэтому форма показывает
 * текущий выбор, а не плодит копии. «Просит доработать» от владельца или
 * коллаборатора блокирует принятие, и мы говорим об этом прямо в панели, а не
 * оставляем владельца гадать, почему кнопка не срабатывает.
 */
export function ReviewPanel({
  suggestionId,
  reviews,
  myVerdict,
  canReview,
  canDismiss,
  isAuthor,
  lang,
  labels,
}: {
  suggestionId: string
  reviews: ReviewView[]
  myVerdict: Verdict | null
  canReview: boolean
  /** Мейнтейнер: может снять ЧУЖОЙ вердикт (своё снимается «убрать ревью»). */
  canDismiss: boolean
  isAuthor: boolean
  lang: Lang
  labels: ReviewLabels
}) {
  const [draft, setDraft] = useState('')
  const [pending, startTransition] = useTransition()
  const blocking = reviews.some((r) => r.blocking)

  const send = (verdict: Verdict) =>
    startTransition(async () => {
      await submitSuggestionReview(suggestionId, verdict, draft)
      setDraft('')
    })

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[0.8125rem] font-semibold text-ink">{labels.title}</span>
        {blocking && <Badge variant="danger">{labels.blocked}</Badge>}
      </div>

      {reviews.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {reviews.map((r) => {
            const meta = VERDICT_META[r.verdict]
            const Icon = meta.icon
            return (
              <div key={r.id} className="flex gap-2">
                <Avatar handle={r.reviewer.handle} avatarUrl={r.reviewer.avatarUrl} size={20} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[0.78125rem]">
                    <span className="font-semibold text-ink">{r.reviewer.name || r.reviewer.handle}</span>
                    {/* Снятый вердикт показываем приглушённо и зачёркнуто: он был,
                        но принятие больше не держит — обе половины важны. */}
                    <span className={`inline-flex items-center gap-1 font-medium ${r.dismissed ? 'text-muted line-through' : meta.cls}`}>
                      <Icon size={12} /> {labels[meta.key]}
                    </span>
                    <span className="text-muted">{timeAgo(r.createdAt, lang)}</span>
                  </div>
                  {r.body && (
                    <div className={`whitespace-pre-wrap text-[0.8125rem] [overflow-wrap:anywhere] ${r.dismissed ? 'text-muted' : 'text-ink-2'}`}>{r.body}</div>
                  )}
                  {r.dismissed && (
                    <div className="mt-0.5 text-[0.78125rem] text-muted [overflow-wrap:anywhere]">
                      {labels.dismissedBy}
                      {r.dismissed.by ? ` @${r.dismissed.by}` : ''}: {r.dismissed.reason}
                    </div>
                  )}
                </div>
                {canDismiss && !r.dismissed && !r.isMine && (
                  <DismissButton suggestionId={suggestionId} reviewerHandle={r.reviewer.handle} labels={labels} />
                )}
              </div>
            )
          })}
        </div>
      )}

      {isAuthor ? (
        <div className="text-[0.78125rem] text-muted">{labels.ownAuthor}</div>
      ) : (
        canReview && (
          <div className="border-t border-border pt-2.5">
            {myVerdict && (
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[0.78125rem] text-ink-2">
                <span>
                  {labels.yourReview}: <b className={VERDICT_META[myVerdict].cls}>{labels[VERDICT_META[myVerdict].key]}</b>
                </span>
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => startTransition(async () => void (await withdrawSuggestionReview(suggestionId)))}
                >
                  <X size={12} /> {labels.withdraw}
                </Button>
              </div>
            )}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={labels.placeholder}
              rows={3}
              className="w-full resize-y rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[0.8125rem] text-ink outline-hidden focus-visible:border-border-strong"
            />
            {/* Ряд вердиктов: одна высота, к правому краю (thumb-зона). На мобиле
                подписи короткие — иконка + одно-два слова. */}
            <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" disabled={pending} onClick={() => send('comment')}>
                <MessageSquare size={13} /> {labels.commentOnly}
              </Button>
              <Button variant="outline" className="text-danger" disabled={pending} onClick={() => send('changes')}>
                <GitPullRequestClosed size={13} /> {labels.requestChanges}
              </Button>
              <Button variant="primary" disabled={pending} onClick={() => send('approve')}>
                {pending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {labels.approve}
              </Button>
            </div>
          </div>
        )
      )}
    </div>
  )
}

/**
 * Снять чужой вердикт — иконка в углу строки ревью.
 *
 * Причина обязательна, поэтому это не мгновенная кнопка, а поповер с полем: снятие
 * чужого голоса — заметное решение, и объяснение остаётся рядом с ним навсегда.
 * Иконка, а не подпись: на мобиле длинному тексту в ряду с аватаром места нет.
 */
function DismissButton({
  suggestionId,
  reviewerHandle,
  labels,
}: {
  suggestionId: string
  reviewerHandle: string
  labels: ReviewLabels
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, startTransition] = useTransition()
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${labels.dismiss} @${reviewerHandle}`}
          title={labels.dismiss}
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
        >
          <ShieldOff size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-3">
        <div className="mb-2 text-[0.78125rem] font-medium text-ink">{labels.dismiss}</div>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={labels.dismissReason}
          rows={3}
          className="text-[0.8125rem]"
        />
        <div className="mt-2 flex justify-end">
          <Button
            variant="primary"
            disabled={pending || !reason.trim()}
            onClick={() =>
              startTransition(async () => {
                const res = await dismissSuggestionReview(suggestionId, reviewerHandle, reason)
                if (res.ok) {
                  setReason('')
                  setOpen(false)
                }
              })
            }
          >
            {pending ? <Loader2 size={13} className="animate-spin" /> : <ShieldOff size={13} />} {labels.dismiss}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
