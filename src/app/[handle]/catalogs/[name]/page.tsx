import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FolderGit2 } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
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
      <h1 className="flex items-center gap-2 text-[22px] font-bold text-ink">
        <FolderGit2 size={20} className="text-ink-2" /> {tr(cat.title, lang) || cat.name}
      </h1>
      {tr(cat.desc, lang) && <p className="mt-1 text-[14px] text-ink-2">{tr(cat.desc, lang)}</p>}
      <div className="mt-1 font-mono text-[12px] text-muted">
        {lists.length} {t('lists', lang).toLowerCase()}
      </div>

      <div className="mt-5">
        {lists.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-16 text-center text-[13.5px] text-muted">
            {t('catalogEmpty', lang)}
          </div>
        ) : (
          <FeedList items={lists} lang={lang} viewerId={viewer?.userId} />
        )}
      </div>
    </div>
  )
}
