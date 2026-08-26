import Link from 'next/link'
import { FolderGit2 } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { tr, type Lang } from '@/shared/i18n'
import type { PublicCatalog } from './queries'
import { cardClass } from '@/shared/ui/card-style'

/** Каталог строкой для ленты Explore (в один столбец, как список репозиториев GitHub).
 *  Без баннера — иконка-папка + бейдж «Каталог» отличают его от списка. */
export function CatalogRow({ c, lang }: { c: PublicCatalog; lang: Lang }) {
  const ru = lang === 'ru'
  const title = tr(c.title, lang) || c.name
  return (
    <Link
      href={`/${c.ownerHandle}/catalogs/${c.name}`}
      className={cardClass({ pad: 'sm', className: 'flex items-start gap-3 transition-colors hover:border-border-strong' })}
    >
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
        <FolderGit2 size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body-lg font-semibold text-ink">{title}</span>
          <span className="rounded-full border border-border px-1.5 py-0.5 text-caption text-ink-2">{ru ? 'Каталог' : 'Catalog'}</span>
        </div>
        {tr(c.desc, lang) && <div className="mt-1 truncate text-body-sm text-ink-2">{tr(c.desc, lang)}</div>}
        <div className="mt-1.5 flex min-w-0 items-center gap-2 text-caption text-muted">
          <Avatar handle={c.ownerHandle} avatarUrl={c.ownerAvatarUrl} size={16} />
          <span className="min-w-0 truncate">{c.ownerHandle}</span>
          <span className="shrink-0 font-mono">· {c.listCount} {ru ? 'списков' : 'lists'}</span>
        </div>
      </div>
    </Link>
  )
}
