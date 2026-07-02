import type { Lang } from '@/shared/i18n'
import { FeedCard } from './FeedCard'
import type { FeedItem } from './queries'

export function FeedList({
  items,
  lang,
  className = 'space-y-3',
}: {
  items: FeedItem[]
  lang: Lang
  className?: string
}) {
  return (
    <div className={className}>
      {items.map((item) => (
        <FeedCard key={item.id} item={item} lang={lang} />
      ))}
    </div>
  )
}
