import { Tag } from 'lucide-react'
import { getSession } from '@/shared/auth/session'
import { getLang } from '@/shared/i18n/server'
import { plural, t } from '@/shared/i18n'
import { getFeed } from '@/features/library/queries'
import { getTag } from '@/features/tags/queries'
import { FeedList } from '@/features/library/FeedList'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Badge } from '@/shared/ui/badge'
import { PageHeader } from '@/shared/ui/PageHeader'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return { title: `#${decodeURIComponent(slug)}` }
}

// Страница тега: списки с этим тегом (переиспользуем getFeed({tag}) + FeedList).
export default async function TagPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = await params
  const slug = decodeURIComponent(raw).toLowerCase()
  const [lang, session] = await Promise.all([getLang(), getSession()])
  const [tag, items] = await Promise.all([getTag(slug), getFeed({ tag: slug, sort: 'trending' }, session?.userId, lang)])

  return (
    <div className="mx-auto w-full max-w-[56.25rem] px-4 py-8">
      <PageHeader
        icon={
          <span className="grid size-10 place-items-center rounded-lg bg-(--accent-soft)">
            <Tag size={20} />
          </span>
        }
        title={tag?.label || slug}
        meta={tag?.curated && <Badge variant="accent">{t('common.curated', lang)}</Badge>}
        subtitle={
          <>
            {items.length} {plural(items.length, 'lists', lang)}
            {tag?.description ? ` · ${tag.description}` : ''}
          </>
        }
      />

      {items.length ? (
        <FeedList items={items} lang={lang} viewerId={session?.userId} />
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
