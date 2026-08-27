import Link from 'next/link'
import { CheckCircle2, CircleDot, MessageSquare } from 'lucide-react'
import { tr, t, type Lang } from '@/shared/i18n'
import { timeAgo } from '@/shared/ui/timeAgo'
import type { IssueSearchRow } from './search'

/** Глобальная выдача issues (scope=issues) — строки в стиле GitHub Issues. */
export function IssueResults({ issues, lang }: { issues: IssueSearchRow[]; lang: Lang }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
      {issues.map((it) => (
        <li key={it.id} className="flex items-start gap-2.5 px-4 py-3">
          {it.status === 'open' ? (
            <CircleDot size={16} className="mt-0.5 shrink-0 text-ok" />
          ) : (
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-accent" />
          )}
          <div className="min-w-0 flex-1">
            <Link
              href={`/${it.ownerHandle}/${it.slug}/issues/${it.number}`}
              className="text-body-lg font-semibold text-ink hover:text-accent"
            >
              {it.title}
            </Link>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-body-sm text-muted">
              <Link href={`/${it.ownerHandle}/${it.slug}`} className="hover:text-ink-2">
                {it.ownerHandle}/{it.slug}
              </Link>
              <span>·</span>
              <span>
                {tr(it.templateTitle, lang)} #{it.number}
              </span>
              <span>·</span>
              <span>{t(it.status === 'open' ? 'issueOpen' : 'issueClosed', lang)}</span>
              <span>·</span>
              <span>{timeAgo(it.updatedAt, lang)}</span>
              {it.commentsCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <MessageSquare size={12} /> {it.commentsCount}
                </span>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
