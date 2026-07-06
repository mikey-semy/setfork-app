import Link from 'next/link'
import { FolderGit2, Plus } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { tr } from '@/shared/i18n'
import { getAdminCollections } from '@/features/collections/queries'
import { createCollection } from '@/features/admin/collection-actions'

export const dynamic = 'force-dynamic'

export default async function AdminCollectionsPage() {
  await requireAdmin()
  const lang = await getLang()
  const ru = lang === 'ru'
  const list = await getAdminCollections()

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-[18px] font-bold text-ink">{ru ? 'Подборки' : 'Collections'}</h1>
        <Link href="/admin" className="text-[13px] text-ink-2 hover:text-ink">← {ru ? 'Админка' : 'Admin'}</Link>
      </div>
      <p className="-mt-4 text-[13px] text-ink-2">
        {ru
          ? 'Курируемые витрины для Explore — списки и каталоги разных авторов в одной подборке.'
          : 'Curated Explore showcases — lists and catalogs from different authors in one collection.'}
      </p>

      <form action={createCollection} className="flex gap-2">
        <input
          name="title"
          required
          maxLength={120}
          placeholder={ru ? 'Название новой подборки' : 'New collection title'}
          className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-none"
        />
        <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13px] font-semibold text-primary-fg">
          <Plus size={14} /> {ru ? 'Создать' : 'Create'}
        </button>
      </form>

      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {list.length === 0 && <div className="px-4 py-10 text-center text-[13.5px] text-muted">{ru ? 'Подборок пока нет.' : 'No collections yet.'}</div>}
        {list.map((c) => (
          <Link key={c.id} href={`/admin/collections/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
            <FolderGit2 size={16} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{tr(c.title, lang)}</span>
            <span className="shrink-0 font-mono text-[11px] text-muted">{c.itemCount} · {c.slug}</span>
            <span className={`shrink-0 rounded px-1.5 text-[11px] ${c.published ? 'text-ok' : 'text-muted'}`}>
              {c.published ? (ru ? 'опубл.' : 'live') : (ru ? 'черновик' : 'draft')}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
