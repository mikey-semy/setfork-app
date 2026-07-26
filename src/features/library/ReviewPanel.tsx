'use client'

import { useState, useTransition } from 'react'
import { Check, MessageSquare, GitPullRequestClosed, Loader2, X } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/button'
import { timeAgo } from '@/shared/ui/timeAgo'
import type { Lang } from '@/shared/i18n'
import { submitSuggestionReview, withdrawSuggestionReview, type ReviewView, type Verdict } from './review-actions'

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
  isAuthor,
  lang,
  labels,
}: {
  suggestionId: string
  reviews: ReviewView[]
  myVerdict: Verdict | null
  canReview: boolean
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
        <span className="text-[13px] font-semibold text-ink">{labels.title}</span>
        {blocking && (
          <span className="rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-danger">
            {labels.blocked}
          </span>
        )}
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
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                    <span className="font-semibold text-ink">{r.reviewer.name || r.reviewer.handle}</span>
                    <span className={`inline-flex items-center gap-1 font-medium ${meta.cls}`}>
                      <Icon size={12} /> {labels[meta.key]}
                    </span>
                    <span className="text-muted">{timeAgo(r.createdAt, lang)}</span>
                  </div>
                  {r.body && (
                    <div className="whitespace-pre-wrap text-[13px] text-ink-2 [overflow-wrap:anywhere]">{r.body}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {isAuthor ? (
        <div className="text-[12.5px] text-muted">{labels.ownAuthor}</div>
      ) : (
        canReview && (
          <div className="border-t border-border pt-2.5">
            {myVerdict && (
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
                <span>
                  {labels.yourReview}: <b className={VERDICT_META[myVerdict].cls}>{labels[VERDICT_META[myVerdict].key]}</b>
                </span>
                <Button
                  variant="ghost"
                  className="h-[38px]"
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
              className="w-full resize-y rounded-md border border-border bg-surface-2 px-2.5 py-2 text-[13px] text-ink outline-hidden focus-visible:border-border-strong"
            />
            {/* Ряд вердиктов: одна высота, к правому краю (thumb-зона). На мобиле
                подписи короткие — иконка + одно-два слова. */}
            <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" className="h-[38px]" disabled={pending} onClick={() => send('comment')}>
                <MessageSquare size={13} /> {labels.commentOnly}
              </Button>
              <Button variant="outline" className="h-[38px] text-danger" disabled={pending} onClick={() => send('changes')}>
                <GitPullRequestClosed size={13} /> {labels.requestChanges}
              </Button>
              <Button variant="primary" className="h-[38px]" disabled={pending} onClick={() => send('approve')}>
                {pending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {labels.approve}
              </Button>
            </div>
          </div>
        )
      )}
    </div>
  )
}
