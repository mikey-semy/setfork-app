import Link from 'next/link'
import { FolderGit2 } from 'lucide-react'
import { plural, t, tr, type Lang } from '@/shared/i18n'
import { cardClass } from '@/shared/ui/card-style'
import type { CatalogRow } from './queries'

export function ProfileCatalogCard({ catalog, handle, lang }: { catalog: CatalogRow; handle: string; lang: Lang }) {
  return (
    <Link
      href={`/${handle}/catalogs/${catalog.name}`}
      className={cardClass({ pad: 'sm', className: 'group block text-left transition-colors hover:border-border-strong' })}
    >
      <div className="flex items-center gap-2">
        <FolderGit2 size={15} className="shrink-0 text-muted" />
        <span className="min-w-0 truncate font-semibold text-accent group-hover:underline">{tr(catalog.title, lang) || catalog.name}</span>
      </div>
      <div className="mt-1 font-mono text-caption text-muted">
        {catalog.listCount} {plural(catalog.listCount, 'lists', lang)}
      </div>
    </Link>
  )
}
