import Link from 'next/link'
import { FolderGit2 } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { AutoBanner } from '@/shared/ui/AutoBanner'
import { tr, type Lang } from '@/shared/i18n'
import type { PublicCatalog } from './queries'

/** Плитка каталога для ленты Explore (рядом со списками). Баннер — авто-градиент
 *  + бейдж «Каталог», чтобы отличать от списка. */
export function CatalogTile({ c, lang }: { c: PublicCatalog; lang: Lang }) {
  const ru = lang === 'ru'
  const title = tr(c.title, lang) || c.name
  return (
    <Link
      href={`/${c.ownerHandle}/catalogs/${c.name}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-border-strong"
    >
      <div className="relative">
        <AutoBanner seed={c.id} label={title} height="h-[120px]" />
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
          <FolderGit2 size={11} /> {ru ? 'Каталог' : 'Catalog'}
        </span>
      </div>
      <div className="p-3.5">
        <div className="truncate text-[15px] font-semibold text-ink group-hover:text-accent">{title}</div>
        {tr(c.desc, lang) && <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-2">{tr(c.desc, lang)}</p>}
        <div className="mt-2 flex min-w-0 items-center gap-2 text-[11.5px] text-muted">
          <Avatar handle={c.ownerHandle} avatarUrl={c.ownerAvatarUrl} size={16} />
          <span className="min-w-0 truncate">{c.ownerHandle}</span>
          <span className="shrink-0 font-mono">· {c.listCount} {ru ? 'списков' : 'lists'}</span>
        </div>
      </div>
    </Link>
  )
}
