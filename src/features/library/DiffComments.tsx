'use client'

import { useState, useTransition } from 'react'
import { MessageSquarePlus, Check, CircleDot, Loader2, Replace, RotateCcw, X } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/button'
import { Markdown } from '@/shared/ui/Markdown'
import { MarkdownEditor } from '@/shared/ui/MarkdownEditor'
import { Textarea } from '@/shared/ui/textarea'
import { Tooltip } from '@/shared/ui/Tooltip'
import { timeAgo } from '@/shared/ui/timeAgo'
import type { Lang } from '@/shared/i18n'
// eslint-disable-next-line boundaries/dependencies -- review-комментарии предложения из comments
import { createBlockThread, replyToBlockThread, setBlockThreadResolved } from '@/features/comments/actions'
import { applySuggestedEdit } from './actions'
// eslint-disable-next-line boundaries/dependencies -- перенос треда в задачу живёт с комментариями
import { threadToIssue } from '@/features/comments/thread-to-issue'
// eslint-disable-next-line boundaries/dependencies -- тип треда из comments
import type { BlockThread } from '@/features/comments/queries'
// eslint-disable-next-line boundaries/dependencies -- тип состояния якоря из comments
import type { ThreadState } from '@/features/comments/state'
import { buttonClass } from '@/shared/ui/button-style'
import { cardClass } from '@/shared/ui/card-style'

export interface DiffCommentLabels {
  add: string
  placeholder: string
  send: string
  /** «Добавить в ревью» — отправка пачкой, замечание пока видно только автору. */
  startReview: string
  /** Пометка на своём черновике замечания. */
  pendingBadge: string
  cancel: string
  reply: string
  resolve: string
  unresolve: string
  resolved: string
  onSelection: string
  onBlock: string
  stateReanchored: string
  orphanHint: string
  /** Обсуждение шло о тексте, которого больше нет (Outdated у GitHub). */
  outdated: string
  /** Перенести обсуждение в задачу списка. */
  toIssue: string
  /** Предложенная правка пункта: подпись поля, кнопка «Применить», пометки. */
  suggestLabel: string
  suggestHint: string
  suggestPh: string
  apply: string
  applied: string
}

export interface RowThread {
  thread: BlockThread
  state: ThreadState
}

/**
 * Review-комментарии к ОДНОМУ пункту диффа предложения — как комментарии к строке
 * в «Files changed»: кнопка появляется по наведению на строку, треды раскрыты под
 * ней. Форма — общий MarkdownEditor (тулбар, Write/Preview, @mention, вложения):
 * своя textarea тут была бы лишним одноразовым элементом.
 */
export function DiffComments({
  owner,
  slug,
  suggestionId,
  blockId,
  rowThreads,
  canComment,
  canApply,
  lang,
  labels,
}: {
  owner: string
  slug: string
  suggestionId: string
  /** Пусто — у пункта нет стабильной идентичности, комментировать нечего. */
  blockId: string | null
  rowThreads: RowThread[]
  canComment: boolean
  /** Может ли зритель применить предложенную правку (право = правка пунктов). */
  canApply: boolean
  lang: Lang
  labels: DiffCommentLabels
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [quote, setQuote] = useState('')
  const [field, setField] = useState('desc')
  // Предложенный текст поля. null — обычное замечание словами; '' — осмысленное
  // предложение «здесь ничего не нужно», поэтому пустая строка и null различаются.
  const [suggest, setSuggest] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const openComposer = () => {
    // Что выделено ПРЯМО СЕЙЧАС — цитата; поле определяем по data-cfield, потому
    // что якорь ищется в исходной строке ОДНОГО поля, а в строке диффа их несколько.
    const sel = typeof window === 'undefined' ? null : window.getSelection()
    const text = sel?.toString().trim() ?? ''
    const host = sel?.anchorNode
      ? (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement)?.closest('[data-cfield]')
      : null
    const detected = host?.getAttribute('data-cfield') ?? ''
    setQuote(text && detected ? text.slice(0, 500) : '')
    setField(text && detected ? detected : 'desc')
    // Предзаполняем предложение выделенным текстом: рецензент правит существующее,
    // а не пишет с нуля — так же ведёт себя suggested change у GitHub.
    setSuggest(null)
    setReplyTo(null)
    setOpen(true)
  }

  const submit = (asDraft: boolean) => {
    const body = draft.trim()
    if (!body || !blockId) return
    startTransition(async () => {
      if (replyTo) await replyToBlockThread(owner, slug, replyTo, body, asDraft, suggest)
      else await createBlockThread(owner, slug, suggestionId, blockId, field, quote, body, asDraft, suggest)
      setDraft('')
      setQuote('')
      setSuggest(null)
      setReplyTo(null)
      setOpen(false)
    })
  }

  const visible = rowThreads.filter((x) => !x.thread.resolvedAt)
  const resolved = rowThreads.filter((x) => x.thread.resolvedAt)

  return (
    <>
      {/* Кнопка «прокомментировать» — как «+» у строки диффа в GitHub: не мозолит
          глаза, появляется по наведению на строку (и всегда видна с клавиатуры). */}
      {/* Кнопка лежит в «жёлобе» строки (absolute), а не в потоке: иначе скрытая
          кнопка резервирует высоту и строки диффа раздуваются. Появляется по
          наведению на строку, на мобиле видна всегда, с клавиатуры — по фокусу. */}
      {canComment && blockId && (
        <Tooltip label={labels.add}>
          <button
            type="button"
            onClick={openComposer}
            aria-label={labels.add}
            className="absolute right-1.5 top-1 grid size-9 place-items-center rounded-md bg-surface/80 text-muted opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 hover:text-ink max-sm:opacity-100"
          >
            <MessageSquarePlus size={15} />
          </button>
        </Tooltip>
      )}

      {(visible.length > 0 || resolved.length > 0 || open) && (
        <div className="mt-2 flex flex-col gap-2">
          {visible.map((x) => (
            <ThreadCard
              key={x.thread.id}
              row={x}
              owner={owner}
              slug={slug}
              lang={lang}
              labels={labels}
              canComment={canComment}
              canApply={canApply}
              onReply={() => {
                setReplyTo(x.thread.id)
                setQuote('')
                setOpen(true)
              }}
            />
          ))}

          {resolved.length > 0 && (
            <ResolvedRow owner={owner} slug={slug} resolved={resolved} labels={labels} canComment={canComment} />
          )}

          {open && (
            <div className={cardClass({ pad: 'sm' })}>
              {quote && (
                <div className="mb-2 border-l-2 border-accent/50 pl-2 text-[0.78125rem] text-ink-2">
                  <span className="text-muted">{labels.onSelection}: </span>
                  <span className="[overflow-wrap:anywhere]">«{quote}»</span>
                </div>
              )}
              {!quote && !replyTo && <div className="mb-2 text-[0.78125rem] text-muted">{labels.onBlock}</div>}
              {/* Общий редактор: тулбар, Write/Preview, @mention, вложения. */}
              <MarkdownEditor
                name="body"
                placeholder={labels.placeholder}
                rows={4}
                lang={lang}
                refScope={{ owner, slug }}
                onValueChange={setDraft}
              />
              {/* ПРЕДЛОЖЕННАЯ ПРАВКА. Свёрнута по умолчанию: обычное замечание —
                  частый случай, а поле ввода сверху отпугивало бы от простого
                  «тут опечатка». Развёрнутая — обычная textarea, а не редактор
                  markdown: это ЗНАЧЕНИЕ поля, а не текст сообщения. */}
              {suggest === null ? (
                <button
                  type="button"
                  onClick={() => setSuggest(quote || '')}
                  className={buttonClass({ variant: 'ghost', className: 'mt-2' })}
                >
                  <Replace size={14} /> {labels.suggestLabel}
                </button>
              ) : (
                <div className={cardClass({ tone: 'accent', pad: 'sm', className: 'mt-2' })}>
                  <div className="mb-1.5 flex items-center gap-1.5 text-[0.78125rem] text-ink-2">
                    <Replace size={13} className="shrink-0 text-accent" />
                    <span className="min-w-0 truncate">{labels.suggestHint}</span>
                    <Tooltip label={labels.cancel}>
                      <button
                        type="button"
                        onClick={() => setSuggest(null)}
                        aria-label={labels.cancel}
                        className="ml-auto grid size-9 shrink-0 place-items-center rounded-md text-muted hover:text-ink"
                      >
                        <X size={14} />
                      </button>
                    </Tooltip>
                  </div>
                  <Textarea
                    value={suggest}
                    onChange={(e) => setSuggest(e.target.value)}
                    rows={3}
                    placeholder={labels.suggestPh}
                    className="text-[0.8125rem]"
                  />
                </div>
              )}
              <div className="mt-2 flex items-center justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  {labels.cancel}
                </Button>
                {/* Два способа отправки, как в GitHub: сразу или в пачку ревью.
                    Пачка — чтобы рецензент мог подумать и переписать до показа. */}
                <Button variant="ghost" onClick={() => submit(true)} disabled={pending || !draft.trim()}>
                  {labels.startReview}
                </Button>
                <Button variant="primary" onClick={() => submit(false)} disabled={pending || !draft.trim()}>
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
  row,
  owner,
  slug,
  lang,
  labels,
  canComment,
  canApply,
  onReply,
}: {
  row: RowThread
  owner: string
  slug: string
  lang: Lang
  labels: DiffCommentLabels
  canComment: boolean
  canApply: boolean
  onReply: () => void
}) {
  const [pending, startTransition] = useTransition()
  const { thread, state } = row
  const orphaned = state.state === 'orphaned'
  const quote = orphaned ? thread.anchorOriginal.exact : state.quote

  return (
    <div className={cardClass({ tone: 'inset', pad: 'sm', dashed: orphaned, className: orphaned ? 'bg-surface-2/60' : '' })}>
      {/* Честное состояние якоря: перепривязан — с уверенностью; потерян — цитата
          из вмороженного снимка, зачёркнутая, но тред НА МЕСТЕ. */}
      {quote && (
        <div className={`mb-1.5 border-l-2 pl-2 text-[0.78125rem] ${orphaned ? 'border-muted text-muted line-through' : 'border-accent/50 text-ink-2'}`}>
          <span className="[overflow-wrap:anywhere]">«{quote}»</span>
        </div>
      )}
      {(orphaned || state.state === 'reanchored' || state.outdated) && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-muted">
          {/* «Устарел» — отдельно от привязки: якорь может отлично находиться, а
              пункт вокруг него переписан, и спор ниже уже про другое. */}
          {state.outdated && (
            <span className="rounded-full bg-warn/15 px-1.5 py-0.5 font-semibold text-warn">{labels.outdated}</span>
          )}
          {orphaned ? labels.orphanHint : state.state === 'reanchored' ? `${labels.stateReanchored} · ${state.confidence}%` : null}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {thread.comments.map((c) => (
          <div key={c.id} className="flex gap-2">
            <Avatar handle={c.author.handle} avatarUrl={c.author.avatarUrl} size={20} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 text-[0.78125rem]">
                <span className="font-semibold text-ink">{c.author.name || c.author.handle}</span>
                <span className="text-muted">{timeAgo(c.createdAt, lang)}</span>
                {/* Свой неотправленный черновик: видно только автору — говорим об этом
                    прямо, иначе он решит, что замечание уже прочитали. */}
                {c.pending && (
                  <span className="rounded-full bg-warn/15 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-warn">{labels.pendingBadge}</span>
                )}
              </div>
              <Markdown className="text-[0.8125rem]">{c.body}</Markdown>
              {/* ПРЕДЛОЖЕННЫЙ ТЕКСТ — применяется кнопкой. Показываем как значение
                  поля (моноширинно, с переносом), а не как разметку: применится
                  ровно то, что видно. */}
              {c.suggestedText !== null && (
                <div className="mt-1.5 overflow-hidden rounded-md border border-accent/40">
                  <div className="flex items-center gap-1.5 border-b border-accent/30 bg-(--accent-soft) px-2 py-1 text-[0.6875rem] text-ink-2">
                    <Replace size={12} className="shrink-0 text-accent" />
                    <span className="min-w-0 truncate">{labels.suggestLabel}</span>
                    {c.appliedAt ? (
                      <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-semibold text-ok">
                        <Check size={12} /> {labels.applied}
                      </span>
                    ) : (
                      canApply && (
                        <Button
                          variant="ghost"
                          className="ml-auto shrink-0 px-2 text-[0.78125rem]"
                          disabled={pending}
                          onClick={() => startTransition(async () => void (await applySuggestedEdit(c.id)))}
                        >
                          {pending ? <Loader2 size={12} className="animate-spin" /> : labels.apply}
                        </Button>
                      )
                    )}
                  </div>
                  <pre className="whitespace-pre-wrap break-words px-2 py-1.5 font-mono text-[0.78125rem] text-ink">
                    {c.suggestedText || '—'}
                  </pre>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {canComment && (
        <div className="mt-2 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onReply}>
            {labels.reply}
          </Button>
          {/* Перенести разговор в задачу: обсуждение на пункте часто упирается в
              то, что решать надо не здесь. Значок с тултипом — подпись в этот
              ряд не влезет на мобиле. */}
          <Tooltip label={labels.toIssue}>
            <Button
              variant="ghost"
              aria-label={labels.toIssue}
              disabled={pending}
              onClick={() => startTransition(async () => void (await threadToIssue(owner, slug, thread.id)))}
            >
              <CircleDot size={14} />
            </Button>
          </Tooltip>
          <Tooltip label={labels.resolve}>
            <Button
              variant="ghost"
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

function ResolvedRow({
  owner,
  slug,
  resolved,
  labels,
  canComment,
}: {
  owner: string
  slug: string
  resolved: RowThread[]
  labels: DiffCommentLabels
  canComment: boolean
}) {
  const [pending, startTransition] = useTransition()
  return (
    <div className="flex flex-wrap items-center gap-2 text-[0.78125rem] text-muted">
      <Check size={13} className="text-ok" />
      <span>
        {labels.resolved}: {resolved.length}
      </span>
      {canComment && (
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => startTransition(async () => void (await setBlockThreadResolved(owner, slug, resolved[0].thread.id, false)))}
        >
          <RotateCcw size={12} /> {labels.unresolve}
        </Button>
      )}
    </div>
  )
}
