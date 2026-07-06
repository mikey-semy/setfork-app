import type { Lang } from '@/shared/i18n'
import { FeedCard } from './FeedCard'
import { FeedTile } from './FeedTile'
import { getStarredIds, type FeedItem } from './queries'

/** Рендерит карточки, подмешивая флаг ⭐ текущего зрителя.
 *  tile — плитки-витрина (Explore) в grid; иначе компактные строки. */
export async function FeedList({
  items,
  lang,
  viewerId,
  className,
  tile = false,
}: {
  items: FeedItem[]
  lang: Lang
  viewerId?: string
  className?: string
  tile?: boolean
}) {
  const starred = viewerId ? await getStarredIds(viewerId, items.map((i) => i.id)) : new Set<string>()
  const wrap = className ?? (tile ? 'grid gap-4 sm:grid-cols-2' : 'space-y-3')
  return (
    <div className={wrap}>
      {items.map((item) =>
        tile ? (
          <FeedTile key={item.id} item={item} lang={lang} starred={starred.has(item.id)} />
        ) : (
          <FeedCard key={item.id} item={item} lang={lang} starred={starred.has(item.id)} />
        ),
      )}
    </div>
  )
}
