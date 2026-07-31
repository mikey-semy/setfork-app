import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FolderGit2 } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { FeedList } from '@/features/library/FeedList'
import { getListsInCatalog } from '@/features/library/queries'
import { getCatalog } from '@/features/catalogs/queries'

export async function generateMetadata({ params }: { params: Promise<{ handle: string; name: string }> }) {
  const { handle, name } = await params
  return { title: `${decodeURIComponent(name)} · ${handle}` }
}

export default async function CatalogPage({ params }: { params: Promise<{ handle: string; name: string }> }) {
  const [{ handle, name }, lang, viewer] = await Promise.all([params, getLang(), getSession()])
  const cat = await getCatalog(handle, name)
  if (!cat) notFound()
  const lists = await getListsInCatalog(cat.id, viewer?.userId)

  return (
    <div className="mx-auto w-full max-w-[1000px] px-6 py-8">
      <div className="mb-1 text-[13px] text-ink-2">
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
          <FeedList items={lists} lang={lang} viewerId={viewer?.userId} />
        )}
      </div>
    </div>
  )
}
