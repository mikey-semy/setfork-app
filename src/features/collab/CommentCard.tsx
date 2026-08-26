import type { ReactNode } from 'react'
import { Avatar } from '@/shared/ui/Avatar'
import { Markdown } from '@/shared/ui/Markdown'
import type { Lang } from '@/shared/i18n'

// Единая карточка комментария/тела (issue и suggestion): шапка (аватар, автор,
// глагол, дата) + markdown-тело + слот реакций. Server-safe (Avatar/Markdown).
// meta — текст-глагол между автором и датой («открыл это» / «прокомментировал»);
// пусто — только автор · дата.
export function CommentCard({
  id,
  handle,
  avatarUrl,
  date,
  meta,
  body,
  refBase,
  reactions,
  actions,
  lang,
}: {
  /** id комментария — якорь #comment-<id> для постоянной ссылки. */
  id?: string
  handle: string
  avatarUrl: string | null
  date: Date
  meta?: string
  body: string
  refBase: string
  reactions?: ReactNode
  /** Меню «...» (клиентский слот) — карточка остаётся серверной. */
  actions?: ReactNode
  lang: Lang
}) {
  const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <div id={id ? `comment-${id}` : undefined} className="scroll-mt-24 overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-3.5 py-2 text-body-sm text-ink-2">
        <Avatar handle={handle} avatarUrl={avatarUrl} size={22} />
        <span className="font-semibold text-ink">{handle}</span>
        <span className="min-w-0 flex-1 truncate">{meta ? ` ${meta}` : ''} · {fmt.format(new Date(date))}</span>
        {actions}
      </div>
      <div className="px-4 py-3">
        {body ? <Markdown refBase={refBase}>{body}</Markdown> : <p className="text-body italic text-muted">—</p>}
        {reactions && <div className="mt-2">{reactions}</div>}
      </div>
    </div>
  )
}
