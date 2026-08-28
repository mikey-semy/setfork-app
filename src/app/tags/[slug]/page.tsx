import type { Metadata } from 'next'
import { breadcrumbList, itemList, JsonLd } from '@/shared/seo/jsonld'
import { Tag } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { plural, t, tr } from '@/shared/i18n'
import { countLists, getFeed } from '@/features/library/queries'
import { getTag } from '@/features/tags/queries'
import { FeedList } from '@/features/library/FeedList'
import { Pagination } from '@/shared/ui/Pagination'
import { pageCount, pageFromParam, pageHref, pageWindow } from '@/shared/lib/paging'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Badge } from '@/shared/ui/badge'
import { PageHeader } from '@/shared/ui/PageHeader'
import { PAGE } from '@/shared/ui/control'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug: raw } = await params
  const slug = decodeURIComponent(raw)
  const tag = await getTag(slug.toLowerCase())
  const label = tag?.label || slug
  // Своё описание у страницы тега, а не общесайтовое: подпись из реестра, если её
  // завели курированием, иначе — что здесь вообще лежит.
  const description = tag?.description || `Lists tagged ${label} on SetFork — runnable, versioned, forkable.`
  return {
    title: `#${slug}`,
    description,
    // Адрес канона — с тем же кодированием, что в карте сайта: тег бывает не только латиницей.
    alternates: { canonical: `/tags/${encodeURIComponent(slug)}` },
    openGraph: { type: 'website', siteName: 'SetFork', title: `#${slug}`, description },
  }
}

// Страница тега: списки с этим тегом (переиспользуем getFeed({tag}) + FeedList).
export default async function TagPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { slug: raw } = await params
  const slug = decodeURIComponent(raw).toLowerCase()
  const [lang, session, sp] = await Promise.all([getLang(), getSession(), searchParams])
  // Сначала СЧЁТ, потом окно: у популярного тега списков могут быть сотни, и страница
  // тянула их все вместе с аватарами авторов, чтобы показать экран.
  const [tag, total] = await Promise.all([getTag(slug), countLists({ tag: slug }, session?.userId)])
  const totalPages = pageCount(total)
  const page = pageFromParam(sp.page, totalPages)
  const items = await getFeed({ tag: slug, sort: 'trending' }, session?.userId, lang, pageWindow(page))

  return (
    <div className={PAGE}>
      {/* Страница тега для машины — это перечень: что здесь лежит и куда ведёт.
          Только первая страница: вторая и дальше — тот же перечень со сдвигом. */}
      {page === 1 && items.length > 0 ? (
        <>
          <JsonLd
            data={itemList(
              `#${slug}`,
              items.map((it) => ({ name: tr(it.title, lang) || it.slug, path: `/${it.ownerHandle}/${it.slug}` })),
            )}
          />
          <JsonLd data={breadcrumbList([{ name: 'Tags', path: '/tags' }, { name: `#${slug}`, path: `/tags/${encodeURIComponent(slug)}` }])} />
        </>
      ) : null}
      <PageHeader
        icon={
          <span className="grid size-10 place-items-center rounded-lg bg-accent-soft">
            <Tag size={20} />
          </span>
        }
        title={tag?.label || slug}
        meta={tag?.curated && <Badge variant="accent">{t('common.curated', lang)}</Badge>}
        subtitle={
          <>
            {total} {plural(total, 'lists', lang)}
            {tag?.description ? ` · ${tag.description}` : ''}
          </>
        }
      />

      {items.length ? (
        <>
          <FeedList items={items} lang={lang} viewerId={session?.userId} />
          <Pagination page={page} totalPages={totalPages} makeHref={pageHref(`/tags/${encodeURIComponent(slug)}`, sp)} lang={lang} />
        </>
      ) : (
        <EmptyState
          icon={<Tag size={28} />}
          title={t('tags.noListsTagYet', lang)}
          hint={t('tags.checkBackLaterCreate', lang)}
          action={{ href: '/new', label: t('newList', lang) }}
        />
      )}
    </div>
  )
}
