'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Check, ChevronDown, ListChecks, Lock, Plus } from 'lucide-react'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/button'
import { SearchField } from '@/shared/ui/SearchField'
import { t, tr, type Lang, type LocaleText } from '@/shared/i18n'

// Единый модуль «панель списков» (правило: переиспользуем и сложные модули).
// Используется дашбордом (Your lists) и drawer'ом (Top lists) — части
// включаются пропсами под место:
//   collapsible (+storageKey) — сворачиваемая секция (chevron, память в LS)
//   searchable  — фильтр по подстроке ('auto' = только когда списков > initialLimit)
//   showNew     — ссылка «+ New» в заголовке
//   showOwner   — префикс handle/ у названия
//   showVersion — vN справа
//   initialLimit — рез до N + кнопка «Показать ещё (M)» (поиск показывает все совпадения)

export interface ListsPanelItem {
  handle: string
  slug: string
  title: LocaleText
  avatarUrl: string | null
  version?: number
  /** Приватный список помечается замком — и в строке, и в заголовке шапки (как у GitHub). */
  visibility?: 'public' | 'private'
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
}) {
  const ru = lang === 'ru'
  // Свёрнутость: ленивый init из LS безопасен — до маунта секция не рендерится с сервера иначе, чем '1'.
  const [open, setOpen] = useState(() => {
    if (!collapsible || !storageKey || typeof window === 'undefined') return true
    return localStorage.getItem(storageKey) !== '0'
  })
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState(false)

  const toggle = () =>
    setOpen((v) => {
      if (storageKey) localStorage.setItem(storageKey, v ? '0' : '1')
      return !v
    })

  const query = q.trim().toLowerCase()
  // Поиск по всем спискам (переключатель в шапке): дёргаем сервер с задержкой ввода.
  // Без remoteSearch поведение прежнее — фильтр по уже загруженным items.
  const [remote, setRemote] = useState<ListsPanelItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    if (!remoteSearch) return
    if (!query) {
      setRemote(null)
      setSearching(false)
      return
    }
    let alive = true
    setSearching(true)
    const id = setTimeout(() => {
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
  const filtered = remoteSearch && query ? (remote ?? []) : localFiltered
  // Поиск показывает все совпадения; без поиска — рез до initialLimit.
  const cut = !query && !expanded && filtered.length > initialLimit
  const shown = cut ? filtered.slice(0, initialLimit) : filtered
  const hasSearch = searchable === true || (searchable === 'auto' && items.length > initialLimit)

  const header =
    headerStyle === 'mono' ? (
      <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">{title}</span>
    ) : (
      <span className="text-[12px] font-semibold text-muted">{title}</span>
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
            className="flex w-full items-center justify-between rounded-md px-0.5 py-1 text-left hover:text-ink"
          >
            {header}
            <ChevronDown size={14} className={`shrink-0 text-muted transition-transform ${open ? '' : '-rotate-90'}`} />
          </button>
        ) : (
          header
        )}
        {showNew && (
          <Link href="/new" className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-semibold text-accent hover:underline">
            <Plus size={13} /> {ru ? 'Создать' : 'New'}
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
              <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[12.5px] text-muted">{emptyText}</div>
            ) : null
          ) : shown.length === 0 ? (
            <div className="px-2 py-3 text-[12.5px] text-muted">
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
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-surface-2 hover:text-ink ${
                    active ? 'bg-surface-2 text-ink' : 'text-ink-2'
                  }`}
                >
                  {l.avatarUrl ? (
                    <Avatar handle={l.handle} avatarUrl={l.avatarUrl} size={18} />
                  ) : (
                    <ListChecks size={16} className="shrink-0 text-muted" />
                  )}
                  {/* Замок = приватный: видно и здесь, и в бредкрамбе шапки — один признак в двух местах. */}
                  {l.visibility === 'private' && <Lock size={12} className="shrink-0 text-muted" />}
                  <span className="min-w-0 truncate">
                    {showOwner && <span className="text-muted">{l.handle}/</span>}
                    <span className="font-semibold text-ink">{tr(l.title, lang)}</span>
                  </span>
                  {active && <Check size={14} className="ml-auto shrink-0 text-accent" />}
                  {showVersion && l.version !== undefined && (
                    <span className="ml-auto shrink-0 font-mono text-[10.5px] text-muted">v{l.version}</span>
                  )}
                </Link>
                )
              })}
            </nav>
          )}
          {/* Раскрыли — должно быть чем и свернуть обратно: тот же тумблер, не тупик. */}
          {(cut || (expanded && !query && filtered.length > initialLimit)) && (
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
