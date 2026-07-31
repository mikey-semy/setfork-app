'use client'

import Link from 'next/link'
import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { SearchField } from './SearchField'

// Единый сайдбар-меню (Ф10 трека ui-system) — «как в docs»: группы с мелкими
// заголовками, активный пункт акцентом на мягкой подложке (стиль Fumadocs,
// без утаскивания их библиотеки), липкая колонка на md+, на мобиле меню
// СВЁРНУТО в одну строку (двадцать пунктов над контентом — это экран скролла
// до первой секции). До него жило три меню тремя стилями: SettingsShell
// (плоское, без мобильной свёртки), AdminNav (группы+свёртка), настройки
// списка. Логика (scrollspy, фильтр поиска, активность ссылок) остаётся у
// вызывающих — здесь только каркас и вид.

export interface SideNavItem {
  key: string
  label: ReactNode
  icon?: ReactNode
  /** Ссылка (страница или #якорь). */
  href: string
  active?: boolean
  /** Пункт не попал под поиск — приглушён и некликабелен. */
  dimmed?: boolean
  danger?: boolean
  onClick?: () => void
}

export interface SideNavGroup {
  /** Заголовок группы; без него — плоский блок (меню настроек). */
  title?: string
  items: SideNavItem[]
}

function NavRow({ it }: { it: SideNavItem }) {
  const cls = cn(
    'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[0.8125rem] transition-colors',
    it.dimmed
      ? 'pointer-events-none opacity-30'
      : it.active
        ? 'bg-(--accent-soft) font-medium text-accent'
        : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
    it.danger && !it.active && 'text-danger',
  )
  const icon = it.icon && <span className={cn('shrink-0', it.active ? 'text-accent' : 'text-muted')}>{it.icon}</span>
  return (
    <Link href={it.href} onClick={it.onClick} aria-current={it.active ? 'page' : undefined} className={cls}>
      {icon}
      <span className="min-w-0 truncate">{it.label}</span>
    </Link>
  )
}

export function SideNav({
  groups,
  search,
  mobileLabel,
  className,
}: {
  groups: SideNavGroup[]
  /** Поле поиска сверху (фильтрация — у вызывающего: dimmed/скрытие пунктов). */
  search?: { value: string; onChange: (v: string) => void; placeholder: string; clearLabel: string }
  /** Подпись мобильной кнопки-свёртки («Разделы», «Меню админки»). */
  mobileLabel: string
  className?: string
}) {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  return (
    <div className={cn('rounded-lg border border-border bg-surface md:contents', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-[2.75rem] w-full items-center justify-between gap-2 px-3 text-left text-[0.8125rem] font-semibold text-ink md:hidden"
      >
        {mobileLabel}
        <ChevronDown size={16} className={cn('text-muted transition-transform', open && 'rotate-180')} />
      </button>
      <div id={panelId} className={cn(open ? 'block' : 'hidden', 'px-3 pb-3 md:contents')}>
        {search && (
          <SearchField
            value={search.value}
            onValueChange={search.onChange}
            placeholder={search.placeholder}
            clearLabel={search.clearLabel}
            className="mb-3"
          />
        )}
        <nav className="flex flex-col gap-4">
          {groups.map((g, i) => {
            if (!g.items.length) return null
            return (
              <div key={g.title ?? i} className="flex flex-col gap-0.5">
                {g.title && (
                  <div className="px-2.5 pb-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted">{g.title}</div>
                )}
                {g.items.map((it) => (
                  <NavRow key={it.key} it={it} />
                ))}
              </div>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
