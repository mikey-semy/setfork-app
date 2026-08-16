'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Check, ChevronDown, ListChecks, Plus } from 'lucide-react'
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
//   initialLimit — рез до N + кнопка «Показать ещё (M)» (поиск показывает все совпадения)

/**
 * Сколько строк поднимает КАЖДАЯ поверхность. Числа живут здесь, потому что это
 * свойство панели, а не случайный аргумент запроса у вызывающего: разъедутся —
 * и «показать ещё» начнёт просить не тот кусок.
 */
/** Рейка сайдбара: показывает ровно столько и не листается. */
export const SIDEBAR_LISTS = 10
/** Панель дашборда: компактный набор как в GitHub Top repositories. */
export const DASHBOARD_LISTS = 7

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
  loadMore,
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
   * Подгрузка СЛЕДУЮЩЕЙ порции с сервера. Без неё «показать ещё» просто
   * раскрывает то, что уже прислали, — так и было до 13.08.2026, и на 518
   * списках это вываливало на экран всё разом (жалоба владельца).
   */
  loadMore?: (offset: number, limit: number) => Promise<ListsPanelItem[]>
  /** Сколько всего есть на сервере — чтобы знать, когда прятать кнопку. */
  total?: number
}) {
  // Свёрнутость: ленивый init из LS безопасен — до маунта секция не рендерится с сервера иначе, чем '1'.
  const [open, setOpen] = useState(() => {
    if (!collapsible || !storageKey || typeof window === 'undefined') return true
    return localStorage.getItem(storageKey) !== '0'
  })
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState(false)
  // Догруженные порции лежат ОТДЕЛЬНО от items: сервер может прислать items заново
  // (ревалидация), и подмешивать их в один массив значило бы терять или дублировать.
  const [more, setMore] = useState<ListsPanelItem[]>([])
  const [loadingMore, setLoadingMore] = useState(false)

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

  const localFiltered = query
    ? items.filter((l) => `${tr(l.title, lang)} ${l.handle}/${l.slug}`.toLowerCase().includes(query))
    : items
  // Порционная подгрузка приходит ВСЛЕД за items, поиск её не касается.
  const withMore = query ? localFiltered : [...items, ...more]
  const filtered = remoteSearch && query ? (remote ?? []) : withMore
  // Поиск показывает все совпадения; без поиска — рез до initialLimit.
  const cut = !query && !expanded && !loadMore && filtered.length > initialLimit
  const shown = cut ? filtered.slice(0, initialLimit) : filtered
  // Сколько ещё лежит на сервере. Без total считать нечего — значит и кнопки нет.
  const restOnServer = loadMore && total !== undefined ? Math.max(0, total - (items.length + more.length)) : 0
  // При серверной пагинации в items лежит ровно первая порция, поэтому решать по
  // items.length нельзя: 7 из 500 скрывали бы поиск как будто списков всего семь.
  const hasSearch = searchable === true || (searchable === 'auto' && (total ?? items.length) > initialLimit)

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
          {/* Серверная пагинация приносит небольшие порции, но после первой порции
              обязана давать и обратный путь: Show less забывает догруженное и снова
              оставляет компактные семь строк Dashboard. */}
          {loadMore && !query && (restOnServer > 0 || more.length > 0) && (
            <div className="mt-1 flex gap-1">
              {restOnServer > 0 && (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={loadingMore}
                  onClick={() => {
                    setLoadingMore(true)
                    loadMore(items.length + more.length, initialLimit)
                      .then((next) => setMore((p) => [...p, ...next]))
                      .finally(() => setLoadingMore(false))
                  }}
                  className="min-w-0 flex-1 justify-center text-accent"
                >
                  {loadingMore ? t('loadingMore', lang) : `${t('showMore', lang)} (${Math.min(initialLimit, restOnServer)})`}
                </Button>
              )}
              {more.length > 0 && (
                <Button variant="ghost" size="xs" onClick={() => setMore([])} className="min-w-0 flex-1 justify-center text-accent">
                  {t('showLess', lang)}
                </Button>
              )}
            </div>
          )}
          {/* Раскрыли — должно быть чем и свернуть обратно: тот же тумблер, не тупик.
              Ветка без loadMore: панель получила весь набор и просто режет его. */}
          {!loadMore && (cut || (expanded && !query && filtered.length > initialLimit)) && (
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
