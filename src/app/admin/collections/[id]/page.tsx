import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink, ImagePlus, Trash2, X } from 'lucide-react'
import { requireAdmin } from '@/shared/auth/admin'
import { getLang } from '@/shared/i18n/server'
import { t, tr } from '@/shared/i18n'
import { AutoBanner } from '@/shared/ui/AutoBanner'
import { getCollectionAdmin } from '@/features/collections/queries'
import { addCollectionItem, deleteCollection, removeCollectionItem, setCollectionCover, updateCollection } from '@/features/admin/collection-actions'
import { Input } from '@/shared/ui/input'
import { Field } from '@/shared/ui/Field'
import { Alert } from '@/shared/ui/Alert'
import { SettingsSection } from '@/shared/ui/SettingsSection'
import { cardClass } from '@/shared/ui/card-style'
import { buttonClass } from '@/shared/ui/button-style'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const lang = await getLang()
  return { title: t('adminCollection', lang) }
}

export default async function EditCollectionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string }> }) {
  await requireAdmin()
  const [{ id }, { e }, lang] = await Promise.all([params, searchParams, getLang()])
  const ru = lang === 'ru'
  const c = await getCollectionAdmin(id)
  if (!c) notFound()

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex items-center justify-between">
        <Link href="/admin/collections" className="text-[0.8125rem] text-ink-2 hover:text-ink">← {ru ? 'Все подборки' : 'All collections'}</Link>
        <Link href={`/collections/${c.slug}`} className="inline-flex items-center gap-1.5 text-[0.8125rem] text-accent hover:underline">
          {ru ? 'Открыть' : 'View'} <ExternalLink size={13} />
        </Link>
      </div>

      {/* Метаданные */}
      <form action={updateCollection} className={cardClass({ pad: 'lg', className: 'flex flex-col gap-4' })}>
        <input type="hidden" name="id" value={c.id} />
        <Field label={ru ? 'Название' : 'Title'}>
          <Input name="title" required defaultValue={tr(c.title, lang)} maxLength={120} />
        </Field>
        <Field label={ru ? 'Описание' : 'Description'}>
          <Input name="desc" defaultValue={tr(c.desc, lang)} maxLength={400} />
        </Field>
        {/* Горизонтальный ряд (подпись слева от поля) — Field сюда не ложится, класс подписи инлайном. */}
        <div className="flex items-center gap-4">
          <label className="text-[0.78125rem] font-semibold text-ink-2">{ru ? 'Акцент (hex)' : 'Accent (hex)'}</label>
          <Input name="accent" defaultValue={c.accent ?? ''} placeholder="#2159d6" className="max-w-[8.75rem] font-mono" />
          <label className="ml-auto inline-flex items-center gap-2 text-[0.8125rem] text-ink">
            <input type="checkbox" name="published" defaultChecked={c.published} /> {ru ? 'Опубликовано' : 'Published'}
          </label>
        </div>
        <div className={buttonClass({ variant: 'ghost', className: 'justify-end' })}>
          <button type="submit" className={buttonClass({ variant: 'primary' })}>{ru ? 'Сохранить' : 'Save'}</button>
        </div>
      </form>

      {/* Обложка */}
      <SettingsSection title={ru ? 'Обложка' : 'Cover'}>
        <div className="mb-3 h-[8.125rem] w-full overflow-hidden rounded-lg border border-border">
          {c.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <AutoBanner seed={c.id} accent={c.accent} label={c.slug} height="h-full" />
          )}
        </div>
        <form action={setCollectionCover} className="flex items-center gap-2">
          <input type="hidden" name="id" value={c.id} />
          <input type="file" name="file" accept="image/*" required className={buttonClass({ variant: 'ghost' })} />
          <button type="submit" className={buttonClass()}>
            <ImagePlus size={14} /> {ru ? 'Загрузить' : 'Upload'}
          </button>
        </form>
      </SettingsSection>

      {/* Элементы */}
      <SettingsSection
        title={ru ? 'Элементы' : 'Items'}
        hint={ru ? 'Добавляй списки (owner/slug) и каталоги (owner/имя-каталога) любых авторов.' : 'Add lists (owner/slug) and catalogs (owner/catalog-name) from any author.'}
      >
        {e === 'notfound' && <Alert variant="warn" className="mb-3">{ru ? 'Не найдено по этой ссылке.' : 'Nothing found for that reference.'}</Alert>}

        <form action={addCollectionItem} className="mb-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="collectionId" value={c.id} />
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            <label className="cursor-pointer px-3 py-2 text-[0.8125rem] text-ink-2 has-checked:bg-surface-2 has-checked:font-semibold has-checked:text-ink">
              <input type="radio" name="kind" value="list" defaultChecked className="sr-only" /> {ru ? 'Список' : 'List'}
            </label>
            <label className="cursor-pointer border-l border-border px-3 py-2 text-[0.8125rem] text-ink-2 has-checked:bg-surface-2 has-checked:font-semibold has-checked:text-ink">
              <input type="radio" name="kind" value="catalog" className="sr-only" /> {ru ? 'Каталог' : 'Catalog'}
            </label>
          </div>
          <Input name="ref" required placeholder="owner/slug" className={buttonClass({ variant: 'ghost', className: 'min-w-0 flex-1 font-mono' })} />
          <button type="submit" className={buttonClass({ variant: 'primary' })}>{ru ? 'Добавить' : 'Add'}</button>
        </form>

        <div className="flex flex-col gap-1.5">
          {c.items.length === 0 && <div className="text-[0.8125rem] text-muted">{ru ? 'Пусто.' : 'Empty.'}</div>}
          {c.items.map((it) => {
            const remove = removeCollectionItem.bind(null, it.itemId, c.id)
            return (
              <div key={it.itemId} className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
                <span className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[0.6875rem] uppercase text-muted">{it.kind}</span>
                <span className={`min-w-0 flex-1 truncate font-mono text-[0.78125rem] ${it.ok ? 'text-ink' : 'text-danger line-through'}`}>{it.label}</span>
                <form action={remove}>
                  <button type="submit" aria-label="remove" className={buttonClass({ variant: 'danger', className: 'hover:text-danger' })}>
                    <X size={14} />
                  </button>
                </form>
              </div>
            )
          })}
        </div>
      </SettingsSection>

      {/* Удаление */}
      <form action={deleteCollection.bind(null, c.id)} className={buttonClass({ variant: 'ghost', className: 'justify-end' })}>
        <button type="submit" className={buttonClass({ variant: 'dangerSolid', className: 'hover:bg-danger/10' })}>
          <Trash2 size={14} /> {ru ? 'Удалить подборку' : 'Delete collection'}
        </button>
      </form>
    </div>
  )
}
