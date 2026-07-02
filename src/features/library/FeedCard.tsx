import Link from 'next/link'
import { GitFork, Star } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { tr, type Lang } from '@/shared/i18n'
import { toggleStar } from '@/features/library/actions'
import type { FeedItem } from './queries'

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + 'k'
  return String(n)
}

/** Карточка-строка (как список репозиториев GitHub): клик по имени открывает;
 *  единственное действие на карточке — ⭐ Star (сигнал качества + коллекция). */
export function FeedCard({ item, lang, starred = false }: { item: FeedItem; lang: Lang; starred?: boolean }) {
  const star = toggleStar.bind(null, item.id)
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-surface px-3.5 py-3 transition-colors hover:border-border-strong">
      <Link href={`/${item.ownerHandle}`} className="flex-shrink-0">
        <Avatar handle={item.ownerHandle} avatarUrl={item.ownerAvatarUrl} size={32} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14.5px]">
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
        <div className="mt-1 truncate text-[12.5px] text-ink-2">{tr(item.desc, lang)}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-3.5 text-[11.5px] text-muted">
          <span className="inline-flex items-center gap-1">
            <GitFork size={12} /> {fmt(item.forksCount)}
          </span>
          <span>
            {new Intl.DateTimeFormat(lang === 'ru' ? 'ru' : 'en', { month: 'short', day: 'numeric' }).format(
              new Date(item.updatedAt),
            )}
          </span>
        </div>
      </div>

      {/* единственное действие — Star */}
      <form action={star} className="flex-shrink-0">
        <button
          title="star"
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors hover:border-border-strong ${
            starred ? 'border-[var(--warn)] text-[var(--warn)]' : 'border-border text-ink-2'
          }`}
        >
          <Star size={14} fill={starred ? 'currentColor' : 'none'} /> {fmt(item.starsCount)}
        </button>
      </form>
    </div>
  )
}
