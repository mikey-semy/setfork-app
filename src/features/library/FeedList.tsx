import type { Lang } from '@/shared/i18n'
import { FeedCard } from './FeedCard'
import { getStarredIds, type FeedItem } from './queries'

/** Рендерит карточки, подмешивая флаг ⭐ текущего зрителя. */
export async function FeedList({
  items,
  lang,
  viewerId,
  className = 'space-y-3',
}: {
  items: FeedItem[]
  lang: Lang
  viewerId?: string
  className?: string
}) {
  const starred = viewerId ? await getStarredIds(viewerId, items.map((i) => i.id)) : new Set<string>()
  return (
    <div className={className}>
      {items.map((item) => (
        <FeedCard key={item.id} item={item} lang={lang} starred={starred.has(item.id)} />
      ))}
    </div>
  )
}
