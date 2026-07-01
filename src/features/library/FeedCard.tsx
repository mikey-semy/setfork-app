import Link from 'next/link'
import { ArrowRight, GitFork, Heart } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { t, tr, type Lang } from '@/shared/i18n'
import { forkTemplate } from '@/features/library/actions'
import type { FeedItem } from './queries'

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + 'k'
  return String(n)
}

export function FeedCard({ item, lang }: { item: FeedItem; lang: Lang }) {
  const fork = forkTemplate.bind(null, item.id)

  return (
    <div className="flex gap-3.5 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong">
      <Link href={`/${item.ownerHandle}`} className="flex-shrink-0">
        <Avatar handle={item.ownerHandle} avatarUrl={item.ownerAvatarUrl} size={40} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[15px]">
            <Link href={`/${item.ownerHandle}`} className="text-ink-2 hover:text-accent">
              {item.ownerHandle}
            </Link>
            <span className="text-ink-2">/</span>
            <Link href={`/${item.ownerHandle}/${item.slug}`} className="font-semibold text-accent hover:underline">
              {item.slug}
            </Link>
          </span>
          <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2">
            v{item.version}
          </span>
          {item.tags.slice(0, 4).map((tag) => (
            <Link
              key={tag}
              href={`/explore?tag=${encodeURIComponent(tag)}`}
              className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-accent hover:underline"
            >
              {tag}
            </Link>
          ))}
        </div>
        <div className="mt-1.5 text-[13px] leading-normal text-ink-2">{tr(item.desc, lang)}</div>
        <div className="mt-2.5 flex flex-wrap gap-4 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Heart size={13} /> {fmt(item.starsCount)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <GitFork size={13} /> {fmt(item.forksCount)}
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
          {t('open', lang)} <ArrowRight size={12} />
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
