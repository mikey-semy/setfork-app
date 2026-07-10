import Link from 'next/link'
import { GitFork, Lock, Star } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { AutoBanner } from '@/shared/ui/AutoBanner'
import { tr, type Lang } from '@/shared/i18n'
import { toggleStar } from '@/features/library/actions'
import type { FeedItem } from './queries'

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + 'k'
  return String(n)
}

/** Плитка-витрина (Explore): баннер сверху (обложка или авто-градиент) + мета. */
export function FeedTile({ item, lang, starred = false }: { item: FeedItem; lang: Lang; starred?: boolean }) {
  const star = toggleStar.bind(null, item.id)
  const base = `/${item.ownerHandle}/${item.slug}`
  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-border-strong">
      <Link href={base} className="block">
        {item.coverImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.coverImage} alt="" className="h-[96px] w-full object-cover" />
        ) : (
          <AutoBanner seed={item.id} accent={item.accent} label={tr(item.title, lang)} height="h-[96px]" />
        )}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar handle={item.ownerHandle} avatarUrl={item.ownerAvatarUrl} size={20} />
          <Link href={`/${item.ownerHandle}`} className="min-w-0 truncate text-[12.5px] text-muted hover:text-accent">{item.ownerHandle}</Link>
          {item.visibility === 'private' && <Lock size={11} className="shrink-0 text-muted" />}
        </div>
        <Link href={base} className="truncate text-[15px] font-semibold text-ink group-hover:text-accent">{tr(item.title, lang)}</Link>
        <p className="line-clamp-2 min-h-[34px] text-[12.5px] leading-snug text-ink-2">{tr(item.desc, lang)}</p>
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {item.tags.slice(0, 3).map((tag) => (
              <Link
                key={tag}
                href={`/search?q=${encodeURIComponent(`tag:${tag}`)}`}
                className="rounded-full bg-(--accent-soft) px-2 py-0.5 text-[11px] font-medium text-accent hover:underline"
              >
                {tag}
              </Link>
            ))}
          </div>
        )}
        <div className="mt-auto flex items-center justify-between border-t border-border pt-2.5">
          <span className="inline-flex items-center gap-1 text-[11.5px] text-muted">
            <GitFork size={12} /> {fmt(item.forksCount)}
          </span>
          <form action={star}>
            <button
              title="star"
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors hover:border-border-strong ${
                starred ? 'border-warn text-warn' : 'border-border text-ink-2'
              }`}
            >
              <Star size={13} fill={starred ? 'currentColor' : 'none'} /> {fmt(item.starsCount)}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
