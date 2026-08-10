import { Compass, Flame, FolderGit2, Hash } from 'lucide-react'
import { TabItem, TabNav } from '@/shared/ui/TabNav'
import { t, type Lang } from '@/shared/i18n'

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

const TABS: { id: ExploreTab; href: string; key: Parameters<typeof t>[0]; icon: React.ReactNode }[] = [
  { id: 'explore', href: '/explore', key: 'explore', icon: <Compass size={15} /> },
  { id: 'tags', href: '/tags', key: 'popularTags', icon: <Hash size={15} /> },
  { id: 'trending', href: '/trending', key: 'trending', icon: <Flame size={15} /> },
  { id: 'collections', href: '/collections', key: 'catalogsTab', icon: <FolderGit2 size={15} /> },
]

export function ExploreNav({ active, lang }: { active: ExploreTab; lang: Lang }) {
  return (
    <TabNav scope="explore" overflow={{ moreLabel: t('moreTabs', lang) }}>
      {TABS.map((tb) => (
        <TabItem key={tb.id} href={tb.href} on={tb.id === active} icon={tb.icon} label={t(tb.key, lang)} />
      ))}
    </TabNav>
  )
}
