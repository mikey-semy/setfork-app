import type { TKey } from '@/shared/i18n'

/**
 * Заголовок страницы в шапке — ТАБЛИЦА «начало пути → ключ словаря», а не лестница
 * условий. Раньше это были семнадцать вложенных тернарников: добавить раздел значило
 * встроиться в середину выражения, и отступы в нём давно разъехались.
 *
 * Порядок значим: выигрывает ПЕРВОЕ совпадение, поэтому частное («/admin/council»)
 * стоит выше общего («/admin»).
 */
const TITLES: { prefix: string; key: TKey }[] = [
  { prefix: '/search', key: 'searchTitle' },
  { prefix: '/explore', key: 'explore' },
  { prefix: '/my-lists', key: 'myLists' },
  { prefix: '/runs', key: 'myRuns' },
  { prefix: '/settings', key: 'settings' },
  { prefix: '/generate', key: 'generateWithAi' },
  { prefix: '/new', key: 'newList' },
  { prefix: '/notifications', key: 'notifications' },
  { prefix: '/guilds', key: 'guildsTitle' },
  { prefix: '/trending', key: 'trending' },
  { prefix: '/collections', key: 'catalogsTab' },
  { prefix: '/tags', key: 'tags' },
  { prefix: '/feedback', key: 'feedback' },
  { prefix: '/admin/council', key: 'councilHall' },
  { prefix: '/admin', key: 'admin' },
]

/**
 * Ключ заголовка для пути, или null — если у страницы своего заголовка в шапке нет.
 *
 * Корень — исключение из таблицы: у вошедшего это «Дашборд», а гостю там показывают
 * hero с огромным лого, и дублировать его строкой в шапке незачем.
 */
export function pageTitleKey(pathname: string, signedIn: boolean): TKey | null {
  if (pathname === '/') return signedIn ? 'dashboard' : null
  return TITLES.find((r) => pathname.startsWith(r.prefix))?.key ?? null
}
