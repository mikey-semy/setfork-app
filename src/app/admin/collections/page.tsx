import Link from 'next/link'
import { FolderGit2, Plus } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { getAdminCollections } from '@/features/collections/queries'
import { createCollection } from '@/features/admin/collection-actions'
import { buttonClass } from '@/shared/ui/button-style'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('adminCollections', lang) }
}

export default async function AdminCollectionsPage() {
  await requireAdmin()
  const lang = await getLang()
  const ru = lang === 'ru'
  const list = await getAdminCollections()

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title={ru ? 'Подборки' : 'Collections'}
        subtitle={
          ru
            ? 'Курируемые витрины для Explore — списки и каталоги разных авторов в одной подборке.'
            : 'Curated Explore showcases — lists and catalogs from different authors in one collection.'
        }
      />

      <form action={createCollection} className="flex gap-2">
        <input
          name="title"
          required
          maxLength={120}
          placeholder={ru ? 'Название новой подборки' : 'New collection title'}
          className={buttonClass({ className: 'flex-1 bg-surface-2 outline-hidden' })}
        />
        <Button type="submit" variant="primary" size="md">
          <Plus size={14} /> {ru ? 'Создать' : 'Create'}
        </Button>
      </form>

      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {list.length === 0 && <EmptyState variant="inline" hint={ru ? 'Подборок пока нет.' : 'No collections yet.'} />}
        {list.map((c) => (
          <Link key={c.id} href={`/admin/collections/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
            <FolderGit2 size={16} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate text-body-lg font-medium text-ink">{tr(c.title, lang)}</span>
            <span className="shrink-0 font-mono text-caption text-muted">{c.itemCount} · {c.slug}</span>
            <span className={`shrink-0 rounded-md px-1.5 text-caption ${c.published ? 'text-ok' : 'text-muted'}`}>
              {c.published ? (ru ? 'опубл.' : 'live') : (ru ? 'черновик' : 'draft')}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
