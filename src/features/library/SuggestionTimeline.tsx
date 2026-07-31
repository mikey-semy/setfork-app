import { Check, GitMerge, GitPullRequest, GitPullRequestClosed, MessageSquare, X } from 'lucide-react'
import { timeAgo } from '@/shared/ui/timeAgo'
import { UserLine } from '@/shared/ui/UserLine'
import type { Lang } from '@/shared/i18n'

export type TimelineKind = 'opened' | 'review-approve' | 'review-changes' | 'review-comment' | 'resolved' | 'merged' | 'closed'

export interface TimelineEvent {
  kind: TimelineKind
  at: Date
  actor?: { handle: string; name: string | null; avatarUrl: string | null } | null
}

export interface TimelineLabels {
  opened: string
  approved: string
  requestedChanges: string
  commented: string
  resolved: string
  merged: string
  closed: string
}

// Иконка и цвет на событие — «история действий» читается взглядом, без чтения слов.
const META: Record<TimelineKind, { icon: typeof Check; cls: string; key: keyof TimelineLabels }> = {
  opened: { icon: GitPullRequest, cls: 'text-accent', key: 'opened' },
  'review-approve': { icon: Check, cls: 'text-ok', key: 'approved' },
  'review-changes': { icon: GitPullRequestClosed, cls: 'text-danger', key: 'requestedChanges' },
  'review-comment': { icon: MessageSquare, cls: 'text-ink-2', key: 'commented' },
  resolved: { icon: Check, cls: 'text-ok', key: 'resolved' },
  merged: { icon: GitMerge, cls: 'text-accent', key: 'merged' },
  closed: { icon: X, cls: 'text-muted', key: 'closed' },
}

/**
 * История действий по правке: кто открыл, кто как отревьюил, что разрешили,
 * чем кончилось. Показывает ПРОЦЕСС, а не только текущий статус — ради этого
 * обсуждение и затевается.
 *
 * События собираются из уже имеющихся данных (правка, ревью, треды) — отдельной
 * таблицы событий не заводим: она рассинхронизировалась бы с источниками.
 */
export function SuggestionTimeline({ events, lang, labels }: { events: TimelineEvent[]; lang: Lang; labels: TimelineLabels }) {
  if (!events.length) return null
  return (
    <ol className="mb-4 flex flex-col gap-2 border-l border-border pl-4">
      {events.map((e, i) => {
        const meta = META[e.kind]
        const Icon = meta.icon
        return (
          <li key={i} className="relative flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.78125rem] text-ink-2">
            {/* Узел на линии — как точки в истории коммитов. */}
            <span aria-hidden className={`absolute -left-[1.3125rem] grid size-4 place-items-center rounded-full bg-surface ${meta.cls}`}>
              <Icon size={12} />
            </span>
            {e.actor && (
              <UserLine handle={e.actor.handle} name={e.actor.name || undefined} avatarUrl={e.actor.avatarUrl} size="xs" />
            )}
            <span>{labels[meta.key]}</span>
            <span className="text-muted">{timeAgo(e.at, lang)}</span>
          </li>
        )
      })}
    </ol>
  )
}
