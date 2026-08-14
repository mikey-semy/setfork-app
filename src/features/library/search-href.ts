/**
 * АДРЕС СТРАНИЦЫ ПОИСКА — собирается одной функцией, и она отдаёт ПОЛНЫЙ путь.
 *
 * Вынесено из страницы после собственной ошибки: помощник выглядел как сборщик строки
 * запроса, и ссылки страниц я собрал как `/search?${qs(...)}` — получилось
 * `/search?/search?q=…`, то есть переход в никуда. Отдельная функция с явным именем и
 * тестом стоит дешевле, чем шанс повторить это на следующем месте вызова.
 *
 * Действующие фильтры переносятся сами: без этого со второй страницы человек молча
 * возвращается ко всей выдаче и не понимает, куда делся отбор.
 */
export const SEARCH_BASE = '/search'

export type SearchParamsish = Record<string, string | undefined>

export function searchHref(current: SearchParamsish, over: SearchParamsish = {}): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...current, ...over })) if (v) p.set(k, v)
  const s = p.toString()
  // Пусто — чистый путь: у «сейчас» должен быть один канонический адрес, иначе `?`-хвост
  // разводит копии одной и той же страницы по ссылкам и поисковикам.
  return s ? `${SEARCH_BASE}?${s}` : SEARCH_BASE
}
