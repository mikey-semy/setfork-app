import Link from 'next/link'
import { AutoBanner } from '@/shared/ui/AutoBanner'
import { SmartImage } from '@/shared/ui/SmartImage'
import { tr, type Lang } from '@/shared/i18n'
import type { CollectionCard as CC } from './queries'

/** Карточка-плитка подборки для витрины Explore. */
export function CollectionCard({ c, lang }: { c: CC; lang: Lang }) {
  const ru = lang === 'ru'
  const title = tr(c.title, lang) || c.slug
  return (
    <Link
      href={`/collections/${c.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-border-strong"
    >
      {c.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <SmartImage src={c.coverUrl} alt="" className="h-32.5 w-full object-cover" />
      ) : (
        <AutoBanner seed={c.id} accent={c.accent} label={title} height="h-32.5" />
      )}
      <div className="p-3.5">
        <div className="truncate text-title font-semibold text-ink group-hover:text-accent">{title}</div>
        {tr(c.desc, lang) && <p className="mt-1 line-clamp-2 text-body-sm text-ink-2">{tr(c.desc, lang)}</p>}
        <div className="mt-2 font-mono text-caption text-muted">{c.itemCount} {ru ? 'элем.' : 'items'}</div>
      </div>
    </Link>
  )
}
