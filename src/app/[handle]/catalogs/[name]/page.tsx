import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FolderGit2 } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { plural, t, tr } from '@/shared/i18n'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { FeedList } from '@/features/library/FeedList'
import { Pagination } from '@/shared/ui/Pagination'
import { canonicalPage, canonicalPageParam, decodeSegment, pageCount, pageHref, pageOrNotFound, pageWindow } from '@/shared/lib/paging'
import { countListsInCatalog, getListsInCatalog } from '@/features/library/queries'
import { getCatalog } from '@/features/catalogs/queries'
import { PAGE } from '@/shared/ui/control'

/** Адрес полки — ОДНОЙ строкой на метаданные и листалку: два способа собрать один путь
 *  уже разошлись на именах с пробелом и кириллицей. */
const catalogPath = (handle: string, name: string) => `/${handle}/catalogs/${name}`

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string; name: string }>
  // Номер страницы нужен canonical'у: он обязан указывать на СЕБЯ, а не на первую.
  searchParams: Promise<{ page?: string }>
}) {
  const [{ handle, name }, sp] = await Promise.all([params, searchParams])
  return {
    title: `${decodeSegment(name)} · ${handle}`,
    alternates: {
      // ⚠️ Путь строится ТЕМ ЖЕ способом, что у листалки ниже: `name` как есть, без
      // повторного кодирования. Сегмент уже пришёл закодированным из адреса, и
      // `encodeURIComponent` кодировал его второй раз — у полки с пробелом или
      // кириллицей canonical указывал на адрес, которым сама листалка не ходит.
      canonical: canonicalPage(catalogPath(handle, name), canonicalPageParam(sp.page)),
    },
  }
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
  // За последней страницей — «не найдено», а не молчаливый показ последней: иначе одно
  // содержимое живёт под бесконечным числом адресов, и canonical у каждого свой.
  const page = pageOrNotFound(sp.page, totalPages)
  if (page === null) notFound()
  const lists = await getListsInCatalog(cat.id, viewer?.userId, pageWindow(page))

  return (
    <div className={PAGE}>
      <div className="mb-1 text-body text-ink-2">
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
            {total} {plural(total, 'lists', lang)}
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
              makeHref={pageHref(catalogPath(handle, name), sp)}
              lang={lang}
            />
          </>
        )}
      </div>
    </div>
  )
}
