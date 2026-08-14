import { tr, type Lang } from '@/shared/i18n'
import { FeedCard } from './FeedCard'
import { FeedTile } from './FeedTile'
import { SelectableCard } from './bulk/SelectableCard'
import { getStarredIds, type FeedItem } from './queries'

/** Рендерит карточки, подмешивая флаг ⭐ текущего зрителя.
 *  tile — плитки-витрина (Explore) в grid; иначе компактные строки.
 *  selectable — карточку можно отметить для пакетного действия (своя библиотека). */
export async function FeedList({
  items,
  lang,
  viewerId,
  className,
  tile = false,
  selectable = false,
}: {
  items: FeedItem[]
  lang: Lang
  viewerId?: string
  className?: string
  tile?: boolean
  selectable?: boolean
}) {
  const starred = viewerId ? await getStarredIds(viewerId, items.map((i) => i.id)) : new Set<string>()
  const wrap = className ?? (tile ? 'grid gap-4 sm:grid-cols-2' : 'space-y-3')
  return (
    <div className={wrap}>
      {items.map((item) => {
        const card = tile ? (
          <FeedTile key={item.id} item={item} lang={lang} starred={starred.has(item.id)} />
        ) : (
          <FeedCard key={item.id} item={item} lang={lang} starred={starred.has(item.id)} />
        )
        // Обёртка выбора получает готовую СЕРВЕРНУЮ карточку детьми: клиентским становится
        // только выбор, сама карточка остаётся серверной. Без режима выбора разметка та же,
        // что и была: лишнего узла в ленте не появляется.
        return selectable ? (
          <SelectableCard key={item.id} id={item.id} label={tr(item.title, lang)}>
            {card}
          </SelectableCard>
        ) : (
          card
        )
      })}
    </div>
  )
}
