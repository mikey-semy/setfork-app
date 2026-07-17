'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronLeft, ChevronRight, Compass, Home, ListChecks, PlayCircle, X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { t, type Lang } from '@/shared/i18n'
import { ListsPanel, type ListsPanelItem } from './ListsPanel'
import { useSidebar } from './sidebar-context'

// ОДИН сайдбар вместо пары «рэйл + drawer»: на десктопе сворачивается своим
// тумблером (иконки ↔ подписи + «Top lists»); свёрнутый НЕ показывает списки.
// На мобилке — тот же сайдбар оверлеем (открывает бургер в топ-баре).
type NavItem = { href: string; label: string; icon: typeof Home }

export function Sidebar({ lang, authed, topLists }: { lang: Lang; authed: boolean; topLists: ListsPanelItem[] }) {
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar()
  const pathname = usePathname()
  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href))

  const items: NavItem[] = [
    { href: '/', label: t('home', lang), icon: Home },
    { href: '/explore', label: t('explore', lang), icon: Compass },
    ...(authed
      ? [
          { href: '/my-lists', label: t('myLists', lang), icon: ListChecks },
          { href: '/runs', label: t('myRuns', lang), icon: PlayCircle },
        ]
      : []),
  ]

  const nav = (expanded: boolean, onNavigate?: () => void) => (
    <nav className="flex flex-col gap-0.5" aria-label={t('menu', lang)}>
      {items.map((it) => {
        const active = isActive(it.href)
        return (
          <Link
            key={it.href}
            href={it.href}
            onClick={onNavigate}
            title={expanded ? undefined : it.label}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center rounded-md font-medium',
              expanded ? 'gap-2.5 px-2.5 py-2 text-[13.5px]' : 'flex-col gap-1 px-1 py-2 text-center text-[9.5px] leading-tight',
              active ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
            )}
          >
            <it.icon size={expanded ? 16 : 18} className={cn('shrink-0', active ? 'text-accent' : 'text-muted')} />
            {it.label}
          </Link>
        )
      })}
    </nav>
  )

  // «Top lists» — только когда развёрнут (свёрнутый прячет списки, как просили).
  const lists = (onNavigate?: () => void) =>
    authed && topLists.length > 0 ? (
      <>
        <div className="my-2 border-t border-border/60" />
        <div className="px-1">
          <ListsPanel
            items={topLists}
            lang={lang}
            title={t('topLists', lang)}
            collapsible
            storageKey="sf.sidebar.topLists"
            searchable
            showOwner
            headerStyle="plain"
            onNavigate={onNavigate}
          />
        </div>
      </>
    ) : null

  return (
    <>
      {/* Desktop: один сворачиваемый сайдбар. min-h во всю высоту экрана — иначе на
          коротких страницах правая граница обрывалась на середине. */}
      <aside
        className={cn(
          'hidden min-h-[calc(100dvh-53px)] shrink-0 border-r border-border bg-surface transition-[width] lg:block print:hidden',
          collapsed ? 'w-[60px]' : 'w-[240px]',
        )}
      >
        <div className="sticky top-[53px] flex h-[calc(100dvh-53px)] flex-col px-2 py-2.5">
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {nav(!collapsed)}
            {!collapsed && lists()}
          </div>
          {/* Свернуть/развернуть — стрелкой ВНИЗУ сайдбара (бургер-логотип живёт в шапке). */}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={t('menu', lang)}
            aria-expanded={!collapsed}
            className="mt-2 grid h-7 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </aside>

      {/* Mobile: тот же сайдбар оверлеем (бургер в топ-баре) */}
      {mobileOpen && (
        <>
          <div className="animate-fade-in fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />
          <aside className="animate-slide-in-left fixed left-0 top-0 z-50 flex h-full w-[280px] max-w-[85vw] flex-col border-r border-border bg-surface p-3 shadow-xl lg:hidden">
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="font-logo text-[18px] leading-none text-ink">SF</span>
              <button
                type="button"
                aria-label={t('menu', lang)}
                onClick={() => setMobileOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              {nav(true, () => setMobileOpen(false))}
              {lists(() => setMobileOpen(false))}
            </div>
          </aside>
        </>
      )}
    </>
  )
}
