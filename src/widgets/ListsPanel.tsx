'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ListChecks, Plus } from 'lucide-react'
import { Pagination } from '@/shared/ui/Pagination'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/button'
import { SearchField } from '@/shared/ui/SearchField'
import { t, tr, type Lang, type LocaleText } from '@/shared/i18n'
import { LIST_VISIBILITY_BADGE, type ListVisibilityState } from '@/features/library/list-visibility'
import { buttonClass } from '@/shared/ui/button-style'
import { SectionLabel } from '@/shared/ui/SectionLabel'

// Единый модуль «панель списков» (правило: переиспользуем и сложные модули).
// Используется дашбордом (Your lists) и drawer'ом (Top lists) — части
// включаются пропсами под место:
//   collapsible (+storageKey) — сворачиваемая секция (chevron, память в LS)
//   searchable  — фильтр по подстроке ('auto' = только когда списков > initialLimit)
//   showNew     — ссылка «+ New» в заголовке
//   showOwner   — префикс handle/ у названия
//   showVersion — vN справа
//   initialLimit — размер порции: без loadPage это рез до N + «Показать ещё (M)»,
//                  с loadPage — размер СТРАНИЦЫ (поиск показывает все совпадения)

// Сколько строк поднимает каждая поверхность — SIDEBAR_LISTS/DASHBOARD_LISTS —
// живёт в `@/shared/lib/paging`, а НЕ здесь. Здесь эти числа читали серверные
// компоненты через границу RSC и получали ссылку на клиентский модуль вместо
// числа; почему это тихо ломало запрос — там же, в комментарии у констант.

/** Замер строки списка (px): содержимое ~20 + `py-1.5` сверху и снизу; зазор — `gap-0.5`.
 *  Числа здесь, а не в разметке, потому что по ним считается резерв высоты страницы. */
const ROW_H = 32
const ROW_GAP = 2

/** Сколько ждём страницу, прежде чем считать, что она не придёт. Столько же, сколько
 *  человек готов смотреть на «Загрузка…», не решив, что интерфейс сломался. */
const PAGE_TIMEOUT_MS = 15_000

export interface ListsPanelItem {
  handle: string
  slug: string
  title: LocaleText
  avatarUrl: string | null
  version?: number
  /** Приватный список помечается замком — и в строке, и в заголовке шапки (как у GitHub). */
  /** Состояние, а не поле БД: черновик закрыт так же, как приватный (list-visibility). */
  visibility?: ListVisibilityState
}

/**
 * Строка, по которой ищет фильтр панели: ВСЕ языки заголовка, а не показанный.
 *
 * `tr()` отдаёт одну строку — ту, что видит читатель, — и фильтр по ней расходился с
 * серверным поиском в том же окне ввода: SQL смотрит `title->>'en' || title->>'ru'`
 * (см. titleText), то есть список {en:'Bread', ru:'Хлебопечка'} на вкладке профиля
 * находится по слову «bread», а в панели у русского читателя — нет. Расхождение видно
 * только на списке с ДВУМЯ заголовками: у одноязычного tr() возвращает то же самое.
 *
 * Живёт В МОДУЛЕ, а не в теле компонента: от пропсов и состояния не зависит, а собранная
 * заново на каждый рендер функция — новая ссылка, то есть промах мемоизации у всякого,
 * кому её передадут (react-doctor/prefer-module-scope-pure-function).
 */
const searchText = (l: ListsPanelItem) => `${Object.values(l.title ?? {}).join(' ')} ${l.handle}/${l.slug}`

export function ListsPanel({
  items,
  lang,
  title,
  collapsible = false,
  storageKey,
  searchable = 'auto',
  showNew = false,
  showOwner = false,
  showVersion = false,
  initialLimit = 5,
  onNavigate,
  emptyText,
  headerStyle = 'mono',
  activeKey,
  remoteSearch,
  loadPage,
  total,
}: {
  items: ListsPanelItem[]
  lang: Lang
  title: string
  collapsible?: boolean
  storageKey?: string
  searchable?: boolean | 'auto'
  showNew?: boolean
  showOwner?: boolean
  showVersion?: boolean
  initialLimit?: number
  onNavigate?: () => void
  emptyText?: string
  headerStyle?: 'mono' | 'plain'
  /** `handle/slug` открытого сейчас списка — помечается галкой (переключатель в шапке). */
  activeKey?: string
  /** Поиск на сервере — по ВСЕМ спискам, а не только по переданным в `items`.
   *  Функция обязана быть стабильной (модульная или useCallback). */
  remoteSearch?: (q: string) => Promise<ListsPanelItem[]>
  /**
   * СТРАНИЦА с сервера: окно `initialLimit` строк, начиная с `offset`. Панель
   * ЗАМЕНЯЕТ показанное этим окном, а не дописывает вниз.
   *
   * Дописывала — и в этом была беда. «Показать ещё» копило порции в одном
   * массиве, поэтому у владельца с 518 списками панель на главной росла до
   * полной библиотеки: сколько нажал, столько строк и висит в DOM, а свернуть
   * можно было только всё разом. Со страницей потолок фиксированный —
   * `initialLimit` строк на любой странице и на любом размере библиотеки.
   */
  loadPage?: (offset: number, limit: number) => Promise<ListsPanelItem[]>
  /** Сколько всего есть на сервере — из него считаются страницы. */
  total?: number
}) {
  // Свёрнутость: ленивый init из LS безопасен — до маунта секция не рендерится с сервера иначе, чем '1'.
  const [open, setOpen] = useState(() => {
    if (!collapsible || !storageKey || typeof window === 'undefined') return true
    return localStorage.getItem(storageKey) !== '0'
  })
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState(false)
  // Страница живёт ОТДЕЛЬНО от items: items — это первая страница с сервера, и она
  // может приехать заново (ревалидация). Держим её как есть, а листание кладём
  // рядом; page === 1 возвращается к items без запроса.
  const [page, setPage] = useState(1)
  const [pageRows, setPageRows] = useState<ListsPanelItem[] | null>(null)
  const [paging, setPaging] = useState(false)
  const [pageFailed, setPageFailed] = useState(false)
  const [searchFailed, setSearchFailed] = useState(false)
  /** Номер поколения запросов. Ответ старого поколения игнорируется целиком: он мог уйти
   *  до того, как набор сменился или человек ушёл на другую страницу. */
  const generation = useRef(0)

  /** Ввод в поиск гасит прошлую неудачу страницы: она больше не про то, что на экране.
   *  Гасим ЗДЕСЬ, в обработчике, а не в теле эффекта — синхронный setState в эффекте
   *  даёт лишний каскад рендеров (react-hooks/set-state-in-effect), и гасить его на
   *  каждый прогон эффекта незачем: повод ровно один — человек начал набирать. Прятать
   *  же сообщение при показе нельзя: скрытое `role="alert"` объявится заново, стоит
   *  очистить поиск. */
  const onSearchInput = (v: string) => {
    setQ(v)
    setPageFailed(false)
  }

  const toggle = () =>
    setOpen((v) => {
      if (storageKey) localStorage.setItem(storageKey, v ? '0' : '1')
      return !v
    })

  // Значок только у ЗАКРЫТЫХ состояний (приватный, черновик): в узкой рейке значок
  // у каждой строки ничего не различал бы, а закрытость — как раз различие. Сам
  // значок и подпись берём из общей таблицы, чтобы черновик выглядел одинаково
  // здесь, в шапке и в переключателе.
  /**
   * Значок видимости — у КАЖДОЙ строки, включая публичную.
   *
   * Раньше он рисовался только у закрытых состояний (черновик, приватный), и колонка
   * получалась рваной: у части строк значок есть, у части нет, названия не выстраиваются
   * в линию. Владелец назвал это как «иконки только у черновиков, а публичный/приватный
   * нету» — второе было ошибкой наблюдения (приватный значок имел), но первое верно, и
   * причина ровно в этом: глаз читает пропуск как отсутствие признака, а не как «признак
   * тут нейтральный».
   *
   * Данные для публичного состояния были заведены с самого начала (глобус в
   * LIST_VISIBILITY_BADGE) — не хватало только показа.
   */
  const visibilityIcon = (state: ListVisibilityState | undefined) => {
    if (!state) return null
    const { Icon, labelKey } = LIST_VISIBILITY_BADGE[state]
    const visLabel = t(labelKey, lang)
    return (
      // Имя значку даёт aria-label; нативный title его дублировал и на пальце не
      // показывался вовсе. Подсказка тут не нужна: подпись видимости стоит рядом.
      <span role="img" aria-label={visLabel} className="shrink-0 text-muted">
        <Icon size={12} />
      </span>
    )
  }

  const query = q.trim().toLowerCase()
  // Поиск по всем спискам (переключатель в шапке): дёргаем сервер с задержкой ввода.
  // Без remoteSearch поведение прежнее — фильтр по уже загруженным items.
  const [remote, setRemote] = useState<ListsPanelItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    if (!remoteSearch || !query) return
    let alive = true
    const id = setTimeout(() => {
      if (!alive) return
      setRemote(null)
      setSearching(true)
      setSearchFailed(false)
      remoteSearch(query)
        .then((r) => {
          if (!alive) return
          setRemote(r)
        })
        // НЕ пустой результат: неудавшийся поиск и поиск без совпадений — разные ответы.
        // Раньше оба показывали «ничего не найдено», то есть панель уверенно сообщала об
        // отсутствии того, чего вообще не искала.
        .catch(() => {
          if (!alive) return
          setRemote([])
          setSearchFailed(true)
        })
        .finally(() => alive && setSearching(false))
    }, 200)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [query, remoteSearch])

  // ДАННЫЕ МОГЛИ СМЕНИТЬСЯ ПОД ПАНЕЛЬЮ. items и total приезжают с сервера заново после
  // ревалидации (создали список, удалили, переименовали), а `pageRows` — снимок, снятый
  // когда-то раньше: панель, стоящая на третьей странице, продолжала бы показывать строки
  // «до изменения» неограниченно долго. Сравниваем дешёвую подпись набора, а не сам массив:
  // на каждый рендер он новый, и сброс по нему кидал бы на первую страницу при любом
  // переходе по сайту.
  const signature = `${total ?? items.length}|${items[0]?.handle}/${items[0]?.slug}`
  const [seenSignature, setSeenSignature] = useState(signature)
  if (seenSignature !== signature) {
    setSeenSignature(signature)
    setPage(1)
    setPageRows(null)
    setPageFailed(false)
  }
  // И гасим поколение: запрос, ушедший ДО смены набора, вернётся со снимком «до» и молча
  // отменит сброс выше — то есть панель снова покажет устаревшие строки, но уже без
  // всякого повода их заподозрить.
  //
  // БАМП В ЭФФЕКТЕ, А НЕ В РЕНДЕРЕ. Запись в ref во время рендера — не мелочь стиля:
  // React вправе отбросить или переиграть рендер, и тогда счётчик уезжает от вычисленного
  // без всякого коммита, то есть годный ответ выбрасывается как «старый». Сбросы состояния
  // выше это переживают (React их отменит вместе с рендером), а мутация ref — нет.
  useEffect(() => {
    generation.current += 1
  }, [signature])

  // Страниц столько, сколько окон в total. Без total листать некуда: панель просто
  // показывает то, что ей дали.
  const totalPages = loadPage && total !== undefined ? Math.max(1, Math.ceil(total / initialLimit)) : 1
  // ОТКРЫТАЯ СТРАНИЦА МОГЛА ИСЧЕЗНУТЬ, пока панель на ней стояла: items и total приезжают
  // с сервера заново (список удалили, стало меньше страниц), а `page` — состояние здесь.
  // Без сброса выходил тупик: на пятой странице из трёх «назад» ведёт на четвёртую,
  // которой нет, «вперёд» — за край, обе стрелки мертвы, и выйти можно только перезагрузкой.
  const outOfRange = page > totalPages
  const shownPage = outOfRange ? 1 : page
  // Что вообще показываем без поиска: страницу с сервера (если листали) или items.
  const base = outOfRange ? items : (pageRows ?? items)
  const localFiltered = query ? base.filter((l) => searchText(l).toLowerCase().includes(query)) : base
  const filtered = remoteSearch && query ? (remote ?? []) : localFiltered
  // Поиск показывает все совпадения; без поиска и без страниц — рез до initialLimit.
  const cut = !query && !expanded && !loadPage && filtered.length > initialLimit
  const shown = cut ? filtered.slice(0, initialLimit) : filtered
  // При серверной пагинации в items лежит ровно первая страница, поэтому решать по
  // items.length нельзя: 7 из 500 скрывали бы поиск как будто списков всего семь.
  const hasSearch = searchable === true || (searchable === 'auto' && (total ?? items.length) > initialLimit)

  // Резервируем, только когда листание вообще есть: у профиля с тремя списками пустое
  // место под семь строк — это дыра на ровном месте.
  const reserveRows = Boolean(loadPage) && !query && totalPages > 1

  const goToPage = (next: number) => {
    if (!loadPage || paging || next === shownPage || next < 1 || next > totalPages) return
    setPageFailed(false)
    // Первая страница уже пришла с сервера — за ней не ходим, иначе «назад» до
    // начала стоит запроса на ровном месте.
    if (next === 1) {
      setPage(1)
      setPageRows(null)
      return
    }
    const id = ++generation.current
    setPaging(true)
    // ПОТОЛОК ОЖИДАНИЯ ОБЯЗАТЕЛЕН. Обещание, которое не разрешается никогда (оборвалась
    // сеть на полпути, спящая вкладка), оставляло `paging` включённым навсегда: обе
    // стрелки неактивны, ошибки нет, выйти можно только перезагрузкой.
    Promise.race([
      loadPage((next - 1) * initialLimit, initialLimit),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), PAGE_TIMEOUT_MS)),
    ])
      .then((rows) => {
        if (generation.current !== id) return
        setPageRows(rows)
        setPage(next)
      })
      // Страница не приехала — остаёмся на текущей и говорим об этом. Молча
      // подсунуть пустоту нельзя: это читалось бы как «списки кончились».
      .catch(() => {
        if (generation.current !== id) return
        setPageFailed(true)
      })
      .finally(() => {
        if (generation.current === id) setPaging(false)
      })
  }

  const header =
    headerStyle === 'mono' ? (
      <SectionLabel as="span">{title}</SectionLabel>
    ) : (
      <span className="text-body-sm font-semibold text-muted">{title}</span>
    )

  return (
    <section>
      {/* Пустой title = без шапки секции (переключатель с единственным списком:
          там показывать нечего, кроме самой строки). */}
      <div className={`flex items-center justify-between ${title || showNew ? 'mb-1.5' : 'hidden'}`}>
        {collapsible ? (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className={buttonClass({ variant: 'ghost', className: 'w-full justify-between text-left' })}
          >
            {header}
            <ChevronDown size={14} className={`shrink-0 text-muted transition-transform ${open ? '' : '-rotate-90'}`} />
          </button>
        ) : (
          header
        )}
        {showNew && (
          <Link href="/new" className="inline-flex shrink-0 items-center gap-1 text-body-sm font-semibold text-accent hover:underline">
            <Plus size={13} /> {t('newListShort', lang)}
          </Link>
        )}
      </div>

      {open && (
        <>
          {hasSearch && (
            <div className="mb-1.5">
              <SearchField value={q} onValueChange={onSearchInput} placeholder={t('findList', lang)} clearLabel={t('clear', lang)} size="xs" />
            </div>
          )}
          {items.length === 0 ? (
            emptyText ? (
              <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-body-sm text-muted">{emptyText}</div>
            ) : null
          ) : shown.length === 0 ? (
            // «Ничего не найдено» — ответ ПОИСКУ. Без поиска пустая страница означает, что
            // набор изменился под нами, и говорить о ненайденном там нечего.
            <div className="px-2 py-3 text-body-sm text-muted">
              {t(searching ? 'searchingLists' : searchFailed ? 'loadFailed' : query ? 'nothingFound' : 'loadFailed', lang)}
            </div>
          ) : (
            <nav
              // Ориентир обязан быть назван: на дашборде рядом стоит листалка — тоже nav, —
              // и в списке ориентиров скринридера два безымянных «navigation» неразличимы.
              aria-label={title || t('yourLists', lang)}
              className="flex flex-col gap-0.5"
              // ВЫСОТА ЗАРЕЗЕРВИРОВАНА под полную страницу. Последняя страница короче
              // остальных, и без резерва панель на ней складывалась: на мобильной главной
              // она стоит первой, поэтому листалка уезжала вверх на пол-экрана — сразу
              // после того, как палец по ней ударил. Фиксированный потолок строк, ради
              // которого всё и затевалось, должен быть виден и как постоянная высота.
              style={reserveRows ? { minHeight: `${(initialLimit * ROW_H + (initialLimit - 1) * ROW_GAP) / 16}rem` } : undefined}
            >
              {shown.map((l) => {
                const active = activeKey === `${l.handle}/${l.slug}`
                return (
                <Link
                  key={`${l.handle}/${l.slug}`}
                  href={`/${l.handle}/${l.slug}`}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  // Строка навигации, не контрол фиксированной высоты: вертикальный
                  // padding задаёт плотность списка, а не конкурирует с кнопкой в ряду.
                  // eslint-disable-next-line no-restricted-syntax
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-body hover:bg-surface-2 hover:text-ink ${
                    active ? 'bg-surface-2 text-ink' : 'text-ink-2'
                  }`}
                >
                  {l.avatarUrl ? (
                    <Avatar handle={l.handle} avatarUrl={l.avatarUrl} size={18} />
                  ) : (
                    <ListChecks size={16} className="shrink-0 text-muted" />
                  )}
                  {/* Видимость: тот же признак, что в бредкрамбе шапки. */}
                  {visibilityIcon(l.visibility)}
                  {/* НАЗВАНИЕ ПЕРВЫМ, ник — после и приглушённо. В рейке шириной ~200px
                      префикс «ник/» съедал больше половины строки, и от названия
                      оставалось «Приготовле…» — то есть список нельзя было узнать. Ник
                      здесь вторичен (в «Топ списков» он у половины строк один и тот же),
                      поэтому он уходит в хвост, сжимается первым и на узкой колонке
                      скрывается совсем. */}
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{tr(l.title, lang)}</span>
                  {showOwner && <span className="hidden min-w-0 shrink truncate text-caption font-normal text-muted sm:inline">{l.handle}</span>}
                  {active && <Check size={14} className="ml-auto shrink-0 text-accent" />}
                  {showVersion && l.version !== undefined && (
                    <span className="ml-auto shrink-0 font-mono text-caption text-muted">v{l.version}</span>
                  )}
                </Link>
                )
              })}
            </nav>
          )}
          {/* Страницы, а не бесконечная лента: на экране всегда ровно одно окно,
              сколько бы списков ни было в библиотеке. Под поиском пагинатора нет —
              выдача поиска это не страница, а совпадения. */}
          {loadPage && !query && (
            // Та же листалка, что на страницах сайта, — здесь только в кнопочном
            // режиме и compact: колонка узкая, номера в неё не лягут.
            <Pagination page={shownPage} totalPages={totalPages} onPage={goToPage} busy={paging} compact lang={lang} className="mt-1" />
          )}
          {/* Под поиском не показываем: сообщение относится к странице, а выдача поиска
              страницей не является — иначе «не удалось загрузить» висит над найденным. */}
          {/* role="alert" — иначе для скринридера неудача НЕМАЯ: живая область листалки
              вернёт то же «Страница 1 / 72», что читалось до нажатия, и выйдет, будто
              ничего и не нажимали. Под поиском не показываем: сообщение про страницу. */}
          {pageFailed && !query && (
            <div role="alert" className="px-2 py-1 text-caption text-danger">
              {t('loadFailed', lang)}
            </div>
          )}
          {/* Раскрыли — должно быть чем и свернуть обратно: тот же тумблер, не тупик.
              Ветка без loadPage: панель получила весь набор и просто режет его. */}
          {!loadPage && (cut || (expanded && !query && filtered.length > initialLimit)) && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 w-full justify-center text-accent"
            >
              {expanded ? t('showLess', lang) : `${t('showMore', lang)} (${filtered.length - initialLimit})`}
            </Button>
          )}
        </>
      )}
    </section>
  )
}
