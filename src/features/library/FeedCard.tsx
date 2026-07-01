import Link from 'next/link'
import { GitFork, Play, Star } from 'lucide-react'
import { Identicon } from '@/shared/ui/Identicon'
import { pick, t, type Lang } from '@/shared/i18n'
import { forkTemplate } from '@/features/runs/actions'
import type { FeedItem } from './queries'

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + 'k'
  return String(n)
}

export function FeedCard({ item, lang }: { item: FeedItem; lang: Lang }) {
  const color = item.topicColor ?? '#6b6b66'
  const topicLabel = pick(item, 'topicLabel', lang) || null
  const fork = forkTemplate.bind(null, item.id)

  return (
    <div className="flex gap-3.5 border-b border-border py-4">
      <Identicon seed={`${item.ownerHandle}/${item.slug}`} color={color} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <Link href={`/${item.ownerHandle}/${item.slug}`} className="text-[15px]">
            <span className="text-ink-2">{item.ownerHandle}/</span>
            <span className="font-semibold text-accent">{item.slug}</span>
          </Link>
          {topicLabel && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] text-ink-2">
              <span className="h-[7px] w-[7px] flex-shrink-0 rounded-full" style={{ background: color }} />
              {topicLabel}
            </span>
          )}
          <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2">
            v{item.version}
          </span>
        </div>
        <div className="mt-1.5 text-[13px] leading-normal text-ink-2">{pick(item, 'desc', lang)}</div>
        <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Play size={13} /> {fmt(item.runsCount)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <GitFork size={13} /> {fmt(item.forksCount)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Star size={13} /> {fmt(item.starsCount)}
          </span>
          <span>
            {t('updated', lang)}{' '}
            {new Intl.DateTimeFormat(lang === 'ru' ? 'ru' : 'en', { month: 'short', day: 'numeric' }).format(
              new Date(item.updatedAt),
            )}
          </span>
        </div>
      </div>
      <div className="flex flex-shrink-0 flex-col items-stretch gap-2">
        <Link
          href={`/${item.ownerHandle}/${item.slug}`}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3.5 py-[7px] text-[12.5px] font-semibold text-primary-fg"
        >
          <Play size={12} /> {t('run', lang)}
        </Link>
        <form action={fork}>
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3.5 py-[7px] text-[12.5px] font-semibold text-ink hover:border-border-strong"
          >
            <GitFork size={12} /> {t('fork', lang)}
          </button>
        </form>
      </div>
    </div>
  )
}
