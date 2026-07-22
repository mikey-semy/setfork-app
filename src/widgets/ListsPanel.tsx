'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ChevronDown, ListChecks, Plus } from 'lucide-react'
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
  const filtered = query ? items.filter((l) => `${tr(l.title, lang)} ${l.handle}/${l.slug}`.toLowerCase().includes(query)) : items
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
      <div className="mb-1.5 flex items-center justify-between">
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
            <div className="px-2 py-3 text-[12.5px] text-muted">{ru ? 'Ничего не найдено' : 'No matches'}</div>
          ) : (
            <nav className="flex flex-col gap-0.5">
              {shown.map((l) => (
                <Link
                  key={`${l.handle}/${l.slug}`}
                  href={`/${l.handle}/${l.slug}`}
                  onClick={onNavigate}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink"
                >
                  {l.avatarUrl ? (
                    <Avatar handle={l.handle} avatarUrl={l.avatarUrl} size={18} />
                  ) : (
                    <ListChecks size={16} className="shrink-0 text-muted" />
                  )}
                  <span className="min-w-0 truncate">
                    {showOwner && <span className="text-muted">{l.handle}/</span>}
                    <span className="font-semibold text-ink">{tr(l.title, lang)}</span>
                  </span>
                  {showVersion && l.version !== undefined && (
                    <span className="ml-auto shrink-0 font-mono text-[10.5px] text-muted">v{l.version}</span>
                  )}
                </Link>
              ))}
            </nav>
          )}
          {cut && (
            <Button variant="ghost" size="xs" onClick={() => setExpanded(true)} className="mt-1 w-full justify-center text-accent">
              {ru ? `Показать ещё (${filtered.length - initialLimit})` : `Show more (${filtered.length - initialLimit})`}
            </Button>
          )}
        </>
      )}
    </section>
  )
}
