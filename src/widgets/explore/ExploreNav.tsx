import { Compass, Flame, FolderGit2, Hash } from 'lucide-react'
import { TabItem, TabNav } from '@/shared/ui/TabNav'
import { t, type Lang } from '@/shared/i18n'
import { EXPLORE_SECTION, type ExploreSectionPath } from '@/shared/nav/explore-section'

/**
 * Навигация раздела «открытие»: витрина, теги, популярное, каталоги.
 *
 * Вкладки — РАЗНЫЕ АДРЕСА, а не параметры одной страницы: так устроен GitHub
 * (`/explore`, `/topics`, `/trending`, `/collections`), и так ссылку можно
 * продиктовать, положить в закладки и отдать поисковику. Прежние `?tab=`
 * продолжают работать — страница `/explore` перенаправляет их на новые пути.
 *
 * Компонент общий, потому что вкладки рисуют четыре разные страницы, и разъехавшийся
 * набор ссылок был бы виден сразу: на одной странице вкладка есть, на соседней нет.
 */
export type ExploreTab = 'explore' | 'tags' | 'trending' | 'collections'

// Порядок и адреса — из общего источника (shared/nav/explore-section), здесь только
// подписи и значки: так набор вкладок не может разойтись с тем, что считают своим
// боковое меню и заголовок шапки.
const TAB_LOOK: Record<ExploreSectionPath, { id: ExploreTab; key: Parameters<typeof t>[0]; icon: React.ReactNode }> = {
  '/explore': { id: 'explore', key: 'explore', icon: <Compass size={15} /> },
  '/tags': { id: 'tags', key: 'popularTags', icon: <Hash size={15} /> },
  '/trending': { id: 'trending', key: 'trending', icon: <Flame size={15} /> },
  '/collections': { id: 'collections', key: 'catalogsTab', icon: <FolderGit2 size={15} /> },
}

export function ExploreNav({ active, lang }: { active: ExploreTab; lang: Lang }) {
  return (
    <TabNav scope="explore" overflow={{ moreLabel: t('moreTabs', lang) }}>
      {EXPLORE_SECTION.map((href) => {
        const look = TAB_LOOK[href]
        return <TabItem key={href} href={href} on={look.id === active} icon={look.icon} label={t(look.key, lang)} />
      })}
    </TabNav>
  )
}
