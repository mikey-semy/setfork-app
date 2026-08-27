import Link from 'next/link'
import { BadgeCheck, GitFork, PlayCircle, Tag } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { t, type Lang } from '@/shared/i18n'
import { Tooltip } from '@/shared/ui/Tooltip'
import { LIST_VISIBILITY_BADGE, listVisibilityState } from './list-visibility'
import type { FeedItem } from './queries'

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + 'k'
  return String(n)
}

/**
 * Единая строка метаданных карточки списка. Explore, Trending и обе профильные
 * вкладки рендерят одну FeedCard, поэтому версия и состояние больше не могут
 * расходиться между Lists и Starred из-за локальной разметки.
 */
export function ListCardMeta({ item, lang, className }: { item: FeedItem; lang: Lang; className?: string }) {
  const base = `/${item.ownerHandle}/${item.slug}`
  const visibility = LIST_VISIBILITY_BADGE[listVisibilityState(item)]
  const VisibilityIcon = visibility.Icon

  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-ink-2', className)}>
      <Link href={`${base}/releases`} className="inline-flex items-center gap-1.5 hover:text-accent">
        <Tag size={14} className="text-muted" />
        <span>
          v<b className="text-ink">{item.version}</b>
        </span>
      </Link>
      <span className="inline-flex items-center gap-1.5">
        <VisibilityIcon size={14} className="text-muted" />
        {t(visibility.labelKey, lang)}
      </span>
      {item.verified && (
        <Tooltip label={t('verifiedBadge', lang)}>
          <span className="inline-flex items-center text-accent" aria-label={t('verifiedBadge', lang)}>
            <BadgeCheck size={14} />
          </span>
        </Tooltip>
      )}
      <Link href={`${base}/forks`} className="inline-flex items-center gap-1.5 hover:text-accent">
        <GitFork size={14} className="text-muted" /> {fmt(item.forksCount)}
      </Link>
      <span className="inline-flex items-center gap-1.5">
        <PlayCircle size={14} className="text-muted" /> {fmt(item.runsCount)}
      </span>
    </div>
  )
}
