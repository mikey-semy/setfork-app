'use client'

import { useRouter } from 'next/navigation'
import { CalendarDays, Users, X } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

// Фильтры страницы «Коммиты» (как «All users» / «All time» у GitHub): автор + дата.
// Значения кладём в query (?author=&since=) — сервер перечитывает и фильтрует список.
export function CommitFilters({
  base,
  authors,
  author,
  since,
  labels,
}: {
  base: string
  authors: { handle: string; name: string | null }[]
  author: string
  since: string
  labels: {
    allAuthors: string
    allTime: string
    lastDay: string
    lastWeek: string
    lastMonth: string
    lastYear: string
    byAuthor: string
    byDate: string
    reset: string
  }
}) {
  const router = useRouter()
  const go = (next: { author?: string; since?: string }) => {
    const a = next.author ?? author
    const s = next.since ?? since
    const q = new URLSearchParams()
    if (a && a !== 'all') q.set('author', a)
    if (s && s !== 'all') q.set('since', s)
    const qs = q.toString()
    router.push(qs ? `${base}?${qs}` : base)
  }
  const active = (author && author !== 'all') || (since && since !== 'all')

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={author || 'all'} onValueChange={(v) => go({ author: v })}>
        <SelectTrigger aria-label={labels.byAuthor} className="h-8 w-auto min-w-[8rem] gap-1.5 px-2.5 text-[0.8125rem]">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Users size={14} className="shrink-0 text-muted" />
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{labels.allAuthors}</SelectItem>
          {authors.map((a) => (
            <SelectItem key={a.handle} value={a.handle}>
              {a.name || a.handle}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={since || 'all'} onValueChange={(v) => go({ since: v })}>
        <SelectTrigger aria-label={labels.byDate} className="h-8 w-auto min-w-[8rem] gap-1.5 px-2.5 text-[0.8125rem]">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <CalendarDays size={14} className="shrink-0 text-muted" />
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{labels.allTime}</SelectItem>
          <SelectItem value="day">{labels.lastDay}</SelectItem>
          <SelectItem value="week">{labels.lastWeek}</SelectItem>
          <SelectItem value="month">{labels.lastMonth}</SelectItem>
          <SelectItem value="year">{labels.lastYear}</SelectItem>
        </SelectContent>
      </Select>

      {active && (
        <button
          type="button"
          onClick={() => go({ author: 'all', since: 'all' })}
          aria-label={labels.reset}
          className="grid size-8 place-items-center rounded-md border border-border text-muted hover:border-border-strong hover:text-ink"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
