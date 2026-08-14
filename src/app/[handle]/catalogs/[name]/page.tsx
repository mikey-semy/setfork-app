import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FolderGit2 } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { FeedList } from '@/features/library/FeedList'
import { Pagination } from '@/shared/ui/Pagination'
import { pageCount, pageFromParam, pageWindow } from '@/shared/lib/paging'
import { countListsInCatalog, getListsInCatalog } from '@/features/library/queries'
import { getCatalog } from '@/features/catalogs/queries'
import { PAGE } from '@/shared/ui/control'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; name: string }> }) {
  const { handle, name } = await params
  return { title: `${decodeURIComponent(name)} · ${handle}` }
}

export default async function CatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; name: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const [{ handle, name }, lang, viewer, sp] = await Promise.all([params, getLang(), getSession(), searchParams])
  const cat = await getCatalog(handle, name)
  if (!cat) notFound()
  // Полка задумана как крупная: на ней могут лежать сотни списков, и грузить их разом
  // ради одного экрана нет причин.
  const total = await countListsInCatalog(cat.id, viewer?.userId)
  const totalPages = pageCount(total)
  const page = pageFromParam(sp.page, totalPages)
  const lists = await getListsInCatalog(cat.id, viewer?.userId, pageWindow(page))

  return (
    <div className={PAGE}>
      <div className="mb-1 text-[0.8125rem] text-ink-2">
        <Link href={`/${handle}`} className="hover:text-accent">
          {handle}
        </Link>{' '}
        / {t('catalogsTab', lang).toLowerCase()}
      </div>
      <PageHeader
        icon={<FolderGit2 size={18} />}
        title={tr(cat.title, lang) || cat.name}
        subtitle={
          <>
            {lists.length} {t('lists', lang).toLowerCase()}
            {tr(cat.desc, lang) ? ` · ${tr(cat.desc, lang)}` : ''}
          </>
        }
      />

      <div>
        {lists.length === 0 ? (
          <EmptyState hint={t('catalogEmpty', lang)} />
        ) : (
          <>
            <FeedList items={lists} lang={lang} viewerId={viewer?.userId} />
            <Pagination
              page={page}
              totalPages={totalPages}
              makeHref={(p) => (p > 1 ? `/${handle}/catalogs/${name}?page=${p}` : `/${handle}/catalogs/${name}`)}
              lang={lang}
            />
          </>
        )}
      </div>
    </div>
  )
}
