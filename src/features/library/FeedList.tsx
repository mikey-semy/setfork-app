import { tr, type Lang } from '@/shared/i18n'
import { FeedCard } from './FeedCard'
import { FeedTile } from './FeedTile'
import { SelectableCard } from './bulk/SelectableCard'
import { getStarredIds, type FeedItem } from './queries'
import type { ListDensity } from '@/shared/lib/list-density'

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
  density = 'comfy',
}: {
  items: FeedItem[]
  lang: Lang
  viewerId?: string
  className?: string
  tile?: boolean
  selectable?: boolean
  /** Плотность строк — выбор зрителя, приходит из куки на сервере. */
  density?: ListDensity
}) {
  const starred = viewerId ? await getStarredIds(viewerId, items.map((i) => i.id)) : new Set<string>()
  // В плотном виде и промежутки уже: иначе экономия внутри карточки уходит в зазоры.
  const wrap = className ?? (tile ? 'grid gap-4 sm:grid-cols-2' : density === 'compact' ? 'space-y-1.5' : 'space-y-3')
  return (
    <div className={wrap}>
      {items.map((item) => {
        const card = tile ? (
          <FeedTile key={item.id} item={item} lang={lang} starred={starred.has(item.id)} />
        ) : (
          <FeedCard key={item.id} item={item} lang={lang} starred={starred.has(item.id)} density={density} />
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
