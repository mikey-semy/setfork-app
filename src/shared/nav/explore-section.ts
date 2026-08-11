/**
 * Пути раздела «открытие» — ОДИН источник для трёх потребителей: вкладок самого
 * раздела, подсветки пункта «Explore» в боковом меню и заголовка в шапке.
 *
 * Раньше раздел был одной страницей с `?tab=`, и всем троим хватало проверки
 * «путь начинается с /explore». Теперь у вкладок свои адреса, и такая проверка
 * молча перестаёт их узнавать: пункт меню гаснет, заголовок пустеет. Список
 * рядом с каждым потребителем разъехался бы при первом же новом разделе —
 * поэтому он здесь.
 */
export const EXPLORE_SECTION = ['/explore', '/tags', '/trending', '/collections'] as const

export type ExploreSectionPath = (typeof EXPLORE_SECTION)[number]

/** Относится ли путь к разделу «открытие» (включая вложенные, вроде /trending/people). */
export function inExploreSection(pathname: string): boolean {
  return EXPLORE_SECTION.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
