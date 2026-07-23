'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronRight, GitCompare, Loader2 } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { timeAgo } from '@/shared/ui/timeAgo'
import type { Lang } from '@/shared/i18n'
import { getCommitDiff, type CommitDiff } from './commit-diff'

const STATUS = {
  added: { sign: '+', cls: 'text-ok' },
  removed: { sign: '−', cls: 'text-danger' },
  changed: { sign: '~', cls: 'text-warn' },
  moved: { sign: '⇅', cls: 'text-accent' },
} as const

interface Author {
  handle: string
  name: string | null
  avatarUrl: string | null
}
interface Labels {
  current: string
  authorNotRecorded: string
  loading: string
  noChanges: string
  fullCompare: string
  expandHint: string
}

/**
 * Строка коммита на странице «Коммиты» с аккордеоном: тап по строке разворачивает
 * ЧТО изменилось в этой версии против предыдущей (дифф пунктов, серверный экшен —
 * тап работает и на мобиле, в отличие от ховера). Точное время — в title (ховер).
 */
export function CommitRow({
  owner,
  slug,
  base,
  version,
  msg,
  createdAtMs,
  isCurrent,
  author,
  lang,
  labels,
}: {
  owner: string
  slug: string
  base: string
  version: number
  msg: string
  createdAtMs: number
  isCurrent: boolean
  author: Author | null
  lang: Lang
  labels: Labels
}) {
  const [open, setOpen] = useState(false)
  const [diff, setDiff] = useState<CommitDiff | null>(null)
  const [loading, setLoading] = useState(false)
  const createdAt = new Date(createdAtMs)

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && !diff && !loading) {
      setLoading(true)
      const d = await getCommitDiff(owner, slug, version, lang)
      setDiff(d)
      setLoading(false)
    }
  }

  return (
    <div className="relative rounded-lg border border-border bg-surface transition-colors hover:border-border-strong">
      {/* Узел-точка на ветви (акцент — текущая версия). */}
      <span aria-hidden className={`absolute -left-5 top-[21px] size-2 rounded-full ${isCurrent ? 'bg-accent' : 'bg-muted'}`} />
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        title={labels.expandHint}
        className="flex w-full items-start gap-2 px-4 py-3 text-left"
      >
        <ChevronRight size={15} className={`mt-0.5 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1">
          {/* Строка 1 — сообщение + версия-тег. */}
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{msg}</span>
            <span className="shrink-0 rounded border border-(--accent)/50 bg-(--accent-soft) px-1.5 font-mono text-[11px] text-accent">v{version}</span>
            {isCurrent && <span className="shrink-0 rounded-full bg-ok/15 px-1.5 py-0.5 text-[10px] font-semibold text-ok">{labels.current}</span>}
          </span>
          {/* Строка 2 — кто и когда. */}
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
            {author ? (
              <span className="inline-flex items-center gap-1.5">
                <Avatar handle={author.handle} avatarUrl={author.avatarUrl} size={18} />
                <span className="font-medium text-ink-2">{author.name || author.handle}</span>
              </span>
            ) : (
              <span>{labels.authorNotRecorded}</span>
            )}
            <span>·</span>
            <span title={createdAt.toLocaleString(lang)}>{timeAgo(createdAt, lang)}</span>
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3 pl-11">
          {loading ? (
            <div className="flex items-center gap-2 text-[12.5px] text-muted">
              <Loader2 size={13} className="animate-spin" /> {labels.loading}
            </div>
          ) : !diff || diff.entries.length === 0 ? (
            <div className="text-[12.5px] text-muted">{labels.noChanges}</div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap gap-3 text-[12px] font-medium">
                {diff.counts.added > 0 && <span className="text-ok">+{diff.counts.added}</span>}
                {diff.counts.removed > 0 && <span className="text-danger">−{diff.counts.removed}</span>}
                {diff.counts.changed > 0 && <span className="text-warn">~{diff.counts.changed}</span>}
                {diff.counts.moved > 0 && <span className="text-accent">⇅{diff.counts.moved}</span>}
              </div>
              <ul className="flex flex-col gap-1 text-[13px]">
                {diff.entries.map((e, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className={`shrink-0 font-mono ${STATUS[e.status].cls}`}>{STATUS[e.status].sign}</span>
                    <span className={`min-w-0 [overflow-wrap:anywhere] ${e.status === 'removed' ? 'text-muted line-through' : 'text-ink-2'}`}>{e.title}</span>
                  </li>
                ))}
              </ul>
              {version > 1 && (
                <Link
                  href={`${base}/compare?from=${version - 1}&to=${version}`}
                  className="mt-2.5 inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
                >
                  <GitCompare size={12} /> {labels.fullCompare}
                </Link>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
