import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink, ImagePlus, Trash2, X } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { tr } from '@/shared/i18n'
import { AutoBanner } from '@/shared/ui/AutoBanner'
import { getCollectionAdmin } from '@/features/collections/queries'
import { addCollectionItem, deleteCollection, removeCollectionItem, setCollectionCover, updateCollection } from '@/features/admin/collection-actions'

export const dynamic = 'force-dynamic'

const field = 'w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[14px] text-ink outline-hidden'
const lbl = 'mb-1.5 block text-[12.5px] font-semibold text-ink-2'
const card = 'rounded-lg border border-border bg-surface p-5'

export default async function EditCollectionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string }> }) {
  await requireAdmin()
  const [{ id }, { e }, lang] = await Promise.all([params, searchParams, getLang()])
  const ru = lang === 'ru'
  const c = await getCollectionAdmin(id)
  if (!c) notFound()

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <Link href="/admin/collections" className="text-[13px] text-ink-2 hover:text-ink">← {ru ? 'Все подборки' : 'All collections'}</Link>
        <Link href={`/collections/${c.slug}`} className="inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline">
          {ru ? 'Открыть' : 'View'} <ExternalLink size={13} />
        </Link>
      </div>

      {/* Метаданные */}
      <form action={updateCollection} className={`${card} flex flex-col gap-4`}>
        <input type="hidden" name="id" value={c.id} />
        <div>
          <label className={lbl}>{ru ? 'Название' : 'Title'}</label>
          <input name="title" required defaultValue={tr(c.title, lang)} maxLength={120} className={field} />
        </div>
        <div>
          <label className={lbl}>{ru ? 'Описание' : 'Description'}</label>
          <input name="desc" defaultValue={tr(c.desc, lang)} maxLength={400} className={field} />
        </div>
        <div className="flex items-center gap-4">
          <label className={lbl + ' mb-0'}>{ru ? 'Акцент (hex)' : 'Accent (hex)'}</label>
          <input name="accent" defaultValue={c.accent ?? ''} placeholder="#2159d6" className={`${field} max-w-[140px] font-mono`} />
          <label className="ml-auto inline-flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" name="published" defaultChecked={c.published} /> {ru ? 'Опубликовано' : 'Published'}
          </label>
        </div>
        <div className="flex justify-end">
          <button className="rounded-md bg-primary px-5 py-2 text-[13px] font-semibold text-primary-fg">{ru ? 'Сохранить' : 'Save'}</button>
        </div>
      </form>

      {/* Обложка */}
      <section className={card}>
        <div className="mb-3 font-semibold text-ink">{ru ? 'Обложка' : 'Cover'}</div>
        <div className="mb-3 h-[130px] w-full overflow-hidden rounded-lg border border-border">
          {c.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <AutoBanner seed={c.id} accent={c.accent} label={c.slug} height="h-full" />
          )}
        </div>
        <form action={setCollectionCover} className="flex items-center gap-2">
          <input type="hidden" name="id" value={c.id} />
          <input type="file" name="file" accept="image/*" required className="text-[13px] text-ink-2" />
          <button className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-ink hover:border-border-strong">
            <ImagePlus size={14} /> {ru ? 'Загрузить' : 'Upload'}
          </button>
        </form>
      </section>

      {/* Элементы */}
      <section className={card}>
        <div className="mb-1 font-semibold text-ink">{ru ? 'Элементы' : 'Items'}</div>
        <p className="mb-3 text-[13px] text-ink-2">
          {ru ? 'Добавляй списки (owner/slug) и каталоги (owner/имя-каталога) любых авторов.' : 'Add lists (owner/slug) and catalogs (owner/catalog-name) from any author.'}
        </p>
        {e === 'notfound' && <div className="mb-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">{ru ? 'Не найдено по этой ссылке.' : 'Nothing found for that reference.'}</div>}

        <form action={addCollectionItem} className="mb-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="collectionId" value={c.id} />
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            <label className="cursor-pointer px-3 py-2 text-[13px] text-ink-2 has-checked:bg-surface-2 has-checked:font-semibold has-checked:text-ink">
              <input type="radio" name="kind" value="list" defaultChecked className="sr-only" /> {ru ? 'Список' : 'List'}
            </label>
            <label className="cursor-pointer border-l border-border px-3 py-2 text-[13px] text-ink-2 has-checked:bg-surface-2 has-checked:font-semibold has-checked:text-ink">
              <input type="radio" name="kind" value="catalog" className="sr-only" /> {ru ? 'Каталог' : 'Catalog'}
            </label>
          </div>
          <input name="ref" required placeholder="owner/slug" className={`${field} min-w-0 flex-1 font-mono`} />
          <button className="rounded-md bg-primary px-4 py-2 text-[13px] font-semibold text-primary-fg">{ru ? 'Добавить' : 'Add'}</button>
        </form>

        <div className="flex flex-col gap-1.5">
          {c.items.length === 0 && <div className="text-[13px] text-muted">{ru ? 'Пусто.' : 'Empty.'}</div>}
          {c.items.map((it) => {
            const remove = removeCollectionItem.bind(null, it.itemId, c.id)
            return (
              <div key={it.itemId} className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
                <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10.5px] uppercase text-muted">{it.kind}</span>
                <span className={`min-w-0 flex-1 truncate font-mono text-[12.5px] ${it.ok ? 'text-ink' : 'text-danger line-through'}`}>{it.label}</span>
                <form action={remove}>
                  <button aria-label="remove" className="rounded p-1 text-muted hover:text-danger">
                    <X size={14} />
                  </button>
                </form>
              </div>
            )
          })}
        </div>
      </section>

      {/* Удаление */}
      <form action={deleteCollection.bind(null, c.id)} className="flex justify-end">
        <button className="inline-flex items-center gap-1.5 rounded-md border border-danger/40 px-3 py-1.5 text-[13px] font-semibold text-danger hover:bg-danger/10">
          <Trash2 size={14} /> {ru ? 'Удалить подборку' : 'Delete collection'}
        </button>
      </form>
    </div>
  )
}
