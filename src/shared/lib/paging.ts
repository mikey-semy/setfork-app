/**
 * СКОЛЬКО СПИСКОВ ПОКАЗЫВАТЬ ЗА РАЗ — одно число на все поверхности.
 *
 * До этого правило было у одной страницы из семи: профиль резал выдачу по 20, а лента
 * тегов, тренды, обзор, поиск, полка и «мои списки» отдавали ВСЁ. Причём отдавали честно —
 * запрос шёл без `limit`, корпус целиком приезжал в память вместе с аватарами авторов, и
 * только потом разметка брала из него первые 30. То есть цена страницы росла вместе с
 * корпусом, а видел человек всё равно экран.
 *
 * Число одно и живёт здесь, потому что «по 20 тут и по 30 там» — это не настройка, а следы
 * разных решений в разное время: у страниц нет причин расходиться, а у нас есть причина не
 * искать по коду, где какое.
 *
 * 20 — то, что уже стояло на профиле и прижилось; менять его заодно с наведением порядка
 * значило бы смешать две правки и не понять потом, которая из них что изменила.
 */
export const LISTS_PER_PAGE = 20

/**
 * Сколько строк поднимает КАЖДАЯ поверхность панели списков.
 *
 * ЭТИ ДВА ЧИСЛА ОБЯЗАНЫ ЖИТЬ В МОДУЛЕ БЕЗ `'use client'`, и это не вкусовщина.
 * До 17.08.2026 они стояли в самой панели (`widgets/ListsPanel.tsx`), а её берут
 * серверные компоненты — корневой layout и дашборд. Через границу RSC любой
 * экспорт клиентского модуля превращается в ССЫЛКУ на него: на сервере
 * `DASHBOARD_LISTS` был не семёркой, а функцией-заглушкой. Тип `number` при этом
 * сохранялся, поэтому ни `tsc`, ни тесты панели ничего не замечали — а drizzle
 * молча выбрасывал `limit` (он берёт только number/object) и поднимал ВЕСЬ
 * корпус: на главной у владельца выводились все 518 списков. Панель после этого
 * «чинили» четырежды, и каждый раз правка была верной и бесполезной.
 *
 * Поэтому: числа здесь, а панель их только принимает пропом.
 */
/** Рейка сайдбара: показывает ровно столько и не листается. */
export const SIDEBAR_LISTS = 10
/** Панель дашборда: компактный набор как в GitHub Top repositories. */
export const DASHBOARD_LISTS = 7

/**
 * ОКНО ВЫДАЧИ, ПРОВЕРЕННОЕ ПЕРЕД ЗАПРОСОМ. Зовётся везде, где окно уходит в `.limit()`.
 *
 * Драйвер ставит предел так: `typeof limit === 'object' || (typeof limit === 'number' &&
 * limit >= 0)`. Всё прочее он МОЛЧА выбрасывает — и запрос уходит в базу без предела,
 * поднимая весь корпус. Ровно это и происходило на главной: `limit` приезжал не числом
 * (см. DASHBOARD_LISTS выше), предел исчезал, приходили все 518 списков, а ошибки не было
 * ни одной — поэтому четыре правки подряд выглядели верными и ничего не меняли.
 *
 * Отсюда правило: битое окно — это исключение, а не «ну покажем всё». Тихий полный скан
 * дороже пятисотки: пятисотку видно сразу, а скан живёт месяцами.
 *
 * Значение в сообщение НЕ подставляем, только `typeof`: подставить — значит тронуть его
 * (`String(x)` дёргает `valueOf`), а именно на этом ссылка на клиентский модуль и бросает,
 * подменяя понятную ошибку невнятной.
 */
export function feedWindow(window: { limit: number; offset?: number }): { limit: number; offset: number } {
  const { limit, offset = 0 } = window
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new TypeError(`paging: limit must be a positive integer, got ${typeof limit}`)
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new TypeError(`paging: offset must be a non-negative integer, got ${typeof offset}`)
  }
  return { limit, offset }
}

/** Окно запроса для страницы (нумерация с 1). Считается ЗДЕСЬ, чтобы `offset` не выводили
 *  руками на каждой странице: ошибка в этой арифметике тихо теряет или дублирует строки. */
export function pageWindow(page: number, perPage = LISTS_PER_PAGE): { limit: number; offset: number } {
  const safe = Math.max(1, Math.floor(page) || 1)
  return { limit: perPage, offset: (safe - 1) * perPage }
}

/** Сколько всего страниц. Ноль записей — всё равно одна страница: пустая выдача это
 *  состояние, а не отсутствие страницы. */
export function pageCount(total: number, perPage = LISTS_PER_PAGE): number {
  return Math.max(1, Math.ceil(total / perPage))
}

/**
 * Номер страницы из адреса: мусор и выход за край приводятся к существующей странице.
 *
 * ЦЕЛОЕ — обязательно. `?page=2.9` иначе доезжало сюда дробью и дальше расходилось со
 * всеми, кто номер округляет: окно просило вторую страницу, а листалка рисовала «2.9»,
 * не подсвечивала текущую и строила ссылку `?page=3.9000000000000004`. Округляем ВНИЗ
 * (`2.9` → вторая), потому что дробь — это всегда мусор в адресе, а не просьба.
 */
export function pageFromParam(raw: string | undefined, totalPages: number): number {
  const n = Math.floor(Number(raw)) || 1
  return Math.min(Math.max(1, n), Math.max(1, totalPages))
}

/** Имя параметра страницы. Одно на сайт: иначе «?page=» тут и «?p=» там. */
export const PAGE_PARAM = 'page'

/**
 * ССЫЛКА НА СТРАНИЦУ — один построитель на все листалки.
 *
 * Каждая страница писала его сама, и они разошлись: «мои списки» тащили дальше `sq`,
 * профиль — семь параметров, а тег и полка не тащили НИЧЕГО. То есть на второй
 * странице тега молча слетал выбранный порядок, а с полки — фильтр, и человек не мог
 * понять, куда делся отбор. Теперь остальные параметры переносятся всегда, а меняется
 * ровно один.
 *
 * Первая страница — БЕЗ `?page=1`: адрес у неё ровно один, иначе поисковик видит две
 * страницы с одним содержимым, а «поделиться ссылкой» даёт то один вид, то другой.
 */
export function pageHref(
  pathname: string,
  params: URLSearchParams | Record<string, string | number | undefined | null>,
  param = PAGE_PARAM,
): (page: number) => string {
  const qs = new URLSearchParams()
  const entries = params instanceof URLSearchParams ? [...params.entries()] : Object.entries(params)
  for (const [k, v] of entries) {
    if (k === param || v === undefined || v === null || v === '') continue
    qs.set(k, String(v))
  }
  return (page: number) => {
    const next = new URLSearchParams(qs)
    if (page > 1) next.set(param, String(page))
    const s = next.toString()
    return s ? `${pathname}?${s}` : pathname
  }
}

/**
 * ОКНО-РАЗВЕДЧИК: берём на одну строку больше, чем покажем.
 *
 * Так узнаётся «есть ли следующая страница» БЕЗ `count(*)`. Разница не косметическая:
 * счёт — это проход по всем подходящим строкам на КАЖДЫЙ показ страницы, и стоит он
 * тем дороже, чем больше корпус, — ровно то, ради чего пагинацию и заводили. Лишняя
 * же строка достаётся даром: она следующая в том же индексе, который запрос и так
 * читает.
 *
 * Платим за это номером последней страницы: с разведчиком листалка знает «дальше есть»,
 * но не знает «сколько всего». Там, где общее число и так посчитано для другого (счётчики
 * вкладок, «найдено N»), берём его — считать второй раз незачем.
 */
export function probeWindow(page: number, perPage = LISTS_PER_PAGE): { limit: number; offset: number } {
  const { limit, offset } = pageWindow(page, perPage)
  return { limit: limit + 1, offset }
}

/** Разбор выдачи разведчика: показываем страницу, лишняя строка — это ответ «дальше есть». */
export function takePage<T>(rows: T[], perPage = LISTS_PER_PAGE): { items: T[]; hasNext: boolean } {
  return { items: rows.slice(0, perPage), hasNext: rows.length > perPage }
}

/**
 * Номера для листалки: первая, последняя, окно вокруг текущей, между ними — многоточие.
 *
 * Считается ЗДЕСЬ, а не в разметке: это арифметика с краями (у первой и последней
 * страницы окно упирается и обязано разворачиваться в другую сторону, иначе на краях
 * листалка становится вдвое короче и прыгает по ширине при переходе).
 */
export function pageNumbers(page: number, totalPages: number, around = 1): (number | 'gap')[] {
  const span = around * 2 + 1
  if (totalPages <= span + 2) return Array.from({ length: totalPages }, (_, i) => i + 1)
  const start = Math.min(Math.max(2, page - around), totalPages - span)
  const end = Math.max(Math.min(totalPages - 1, page + around), span + 1)
  const out: (number | 'gap')[] = [1]
  if (start > 2) out.push('gap')
  for (let p = start; p <= end; p++) out.push(p)
  if (end < totalPages - 1) out.push('gap')
  out.push(totalPages)
  return out
}
