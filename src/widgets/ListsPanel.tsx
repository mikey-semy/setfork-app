'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Check, ChevronDown, ListChecks, Plus } from 'lucide-react'
import { Pagination } from '@/shared/ui/Pagination'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/button'
import { SearchField } from '@/shared/ui/SearchField'
import { t, tr, type Lang, type LocaleText } from '@/shared/i18n'
import { LIST_VISIBILITY_BADGE, type ListVisibilityState } from '@/features/library/list-visibility'
import { buttonClass } from '@/shared/ui/button-style'

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

  const toggle = () =>
    setOpen((v) => {
      if (storageKey) localStorage.setItem(storageKey, v ? '0' : '1')
      return !v
    })

  // Значок только у ЗАКРЫТЫХ состояний (приватный, черновик): в узкой рейке значок
  // у каждой строки ничего не различал бы, а закрытость — как раз различие. Сам
  // значок и подпись берём из общей таблицы, чтобы черновик выглядел одинаково
  // здесь, в шапке и в переключателе.
  const restrictedIcon = (state: ListVisibilityState | undefined) => {
    if (!state || state === 'public') return null
    const { Icon, labelKey } = LIST_VISIBILITY_BADGE[state]
    const visLabel = t(labelKey, lang)
    return (
      <span role="img" title={visLabel} aria-label={visLabel} className="shrink-0 text-muted">
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
      remoteSearch(query)
        .then((r) => alive && setRemote(r))
        .catch(() => alive && setRemote([]))
        .finally(() => alive && setSearching(false))
    }, 200)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [query, remoteSearch])

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
  const localFiltered = query
    ? base.filter((l) => `${tr(l.title, lang)} ${l.handle}/${l.slug}`.toLowerCase().includes(query))
    : base
  const filtered = remoteSearch && query ? (remote ?? []) : localFiltered
  // Поиск показывает все совпадения; без поиска и без страниц — рез до initialLimit.
  const cut = !query && !expanded && !loadPage && filtered.length > initialLimit
  const shown = cut ? filtered.slice(0, initialLimit) : filtered
  // При серверной пагинации в items лежит ровно первая страница, поэтому решать по
  // items.length нельзя: 7 из 500 скрывали бы поиск как будто списков всего семь.
  const hasSearch = searchable === true || (searchable === 'auto' && (total ?? items.length) > initialLimit)

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
    setPaging(true)
    loadPage((next - 1) * initialLimit, initialLimit)
      .then((rows) => {
        setPageRows(rows)
        setPage(next)
      })
      // Страница не приехала — остаёмся на текущей и говорим об этом. Молча
      // подсунуть пустоту нельзя: это читалось бы как «списки кончились».
      .catch(() => setPageFailed(true))
      .finally(() => setPaging(false))
  }

  const header =
    headerStyle === 'mono' ? (
      <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.07em] text-muted">{title}</span>
    ) : (
      <span className="text-[0.78125rem] font-semibold text-muted">{title}</span>
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
          <Link href="/new" className="inline-flex shrink-0 items-center gap-1 text-[0.78125rem] font-semibold text-accent hover:underline">
            <Plus size={13} /> {t('newListShort', lang)}
          </Link>
        )}
      </div>

      {open && (
        <>
          {hasSearch && (
            <div className="mb-1.5">
              <SearchField value={q} onValueChange={setQ} placeholder={t('findList', lang)} clearLabel={t('clear', lang)} size="xs" />
            </div>
          )}
          {items.length === 0 ? (
            emptyText ? (
              <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[0.78125rem] text-muted">{emptyText}</div>
            ) : null
          ) : shown.length === 0 ? (
            <div className="px-2 py-3 text-[0.78125rem] text-muted">
              {t(searching ? 'searchingLists' : 'nothingFound', lang)}
            </div>
          ) : (
            <nav className="flex flex-col gap-0.5">
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
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[0.8125rem] hover:bg-surface-2 hover:text-ink ${
                    active ? 'bg-surface-2 text-ink' : 'text-ink-2'
                  }`}
                >
                  {l.avatarUrl ? (
                    <Avatar handle={l.handle} avatarUrl={l.avatarUrl} size={18} />
                  ) : (
                    <ListChecks size={16} className="shrink-0 text-muted" />
                  )}
                  {/* Замок/черновик: тот же признак, что в бредкрамбе шапки. */}
                  {restrictedIcon(l.visibility)}
                  {/* НАЗВАНИЕ ПЕРВЫМ, ник — после и приглушённо. В рейке шириной ~200px
                      префикс «ник/» съедал больше половины строки, и от названия
                      оставалось «Приготовле…» — то есть список нельзя было узнать. Ник
                      здесь вторичен (в «Топ списков» он у половины строк один и тот же),
                      поэтому он уходит в хвост, сжимается первым и на узкой колонке
                      скрывается совсем. */}
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{tr(l.title, lang)}</span>
                  {showOwner && <span className="hidden min-w-0 shrink truncate text-[0.6875rem] font-normal text-muted sm:inline">{l.handle}</span>}
                  {active && <Check size={14} className="ml-auto shrink-0 text-accent" />}
                  {showVersion && l.version !== undefined && (
                    <span className="ml-auto shrink-0 font-mono text-[0.6875rem] text-muted">v{l.version}</span>
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
          {pageFailed && <div className="px-2 py-1 text-[0.6875rem] text-danger">{t('loadFailed', lang)}</div>}
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
