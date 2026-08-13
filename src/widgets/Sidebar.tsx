'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { inExploreSection } from '@/shared/nav/explore-section'
import { ChevronLeft, Compass, Home, ListChecks, PlayCircle, X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { t, type Lang } from '@/shared/i18n'
import { ListsPanel, type ListsPanelItem } from './ListsPanel'
import { useSidebar } from './sidebar-context'
import { buttonClass } from '@/shared/ui/button-style'

// ОДИН сайдбар: показан ЦЕЛИКОМ (иконки + подписи + «Top lists») или скрыт ЦЕЛИКОМ —
// без промежуточного мини-рельса (иконки+подписи в узкой колонке смысла не давали).
// Тумблер — стрелка внизу панели И бургер ☰ в шапке (на десктопе он же скрывает/
// показывает). На мобилке — тот же сайдбар оверлеем.
type NavItem = { href: string; label: string; icon: typeof Home }

export function Sidebar({ lang, authed, topLists }: { lang: Lang; authed: boolean; topLists: ListsPanelItem[] }) {
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar()
  const pathname = usePathname()
  const isActive = (href: string) =>
    // «Explore» подсвечен на всех адресах своего раздела: вкладки живут по разным
    // путям (/tags, /trending, /collections), и сравнение с одним префиксом гасило бы
    // пункт меню, стоило перейти на соседнюю вкладку.
    href === '/explore'
      ? inExploreSection(pathname)
      : pathname === href || (href !== '/' && pathname.startsWith(href))

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

  const nav = (onNavigate?: () => void) => (
    <nav className="flex flex-col gap-0.5" aria-label={t('menu', lang)}>
      {items.map((it) => {
        const active = isActive(it.href)
        return (
          <Link
            key={it.href}
            href={it.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.8125rem] font-medium',
              active ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
            )}
          >
            <it.icon size={16} className={cn('shrink-0', active ? 'text-accent' : 'text-muted')} />
            {it.label}
          </Link>
        )
      })}
    </nav>
  )

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
            // Без showOwner: в этом рейке лежат СВОИ списки зрителя (layout берёт их
            // getUserTemplates по нему же), поэтому «ник/» повторялся в каждой строке и
            // съедал больше половины ширины — от названия оставалось «Приготовле…».
            headerStyle="plain"
            onNavigate={onNavigate}
          />
        </div>
      </>
    ) : null

  return (
    <>
      {/* Desktop: панель фиксирована во всю высоту экрана под шапкой — не улетает при
          скролле и всегда доходит до низа (в потоке она обрывалась и уезжала вместе со
          страницей на коротких экранах). Ширину в потоке держит спейсер ниже. */}
      {/* Спейсер: резервирует место под фиксированную панель, чтобы контент не уезжал под неё. */}
      <div
        aria-hidden
        className={cn('hidden shrink-0 transition-[width] duration-200 lg:block print:hidden', collapsed ? 'w-0' : 'w-[15rem]')}
      />
      <aside
        aria-hidden={collapsed}
        className={cn(
          'fixed bottom-0 left-0 top-[3.3125rem] z-20 hidden overflow-hidden bg-surface transition-[width] duration-200 lg:block print:hidden',
          collapsed ? 'w-0 border-r-0' : 'w-[15rem] border-r border-border',
        )}
      >
        {!collapsed && (
          <div className="flex h-full w-[15rem] flex-col px-2 py-2.5">
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              {nav()}
              {lists()}
            </div>
            {/* Свернуть — стрелкой внизу панели (развернуть обратно — бургером в шапке). */}
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={t('nav.hideMenu', lang)}
              className={buttonClass({ variant: 'ghost', className: 'mt-2 shrink-0 justify-start text-muted' })}
            >
              <ChevronLeft size={15} className="shrink-0" />
              {t('nav.collapse', lang)}
            </button>
          </div>
        )}
      </aside>

      {/* Mobile: тот же сайдбар оверлеем (бургер в топ-баре) */}
      {mobileOpen && (
        <>
          <div className="sf-overlay-in fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMobileOpen(false)} />
          <aside className="animate-slide-in-left fixed left-0 top-0 z-50 flex h-full w-[17.5rem] max-w-[85vw] flex-col border-r border-border bg-surface p-3 shadow-xl lg:hidden">
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="font-logo text-[1.125rem] leading-none text-ink">SF</span>
              <button
                type="button"
                aria-label={t('menu', lang)}
                onClick={() => setMobileOpen(false)}
                className={buttonClass({ variant: 'ghost', className: 'size-8 p-0' })}
              >
                <X size={18} />
              </button>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              {nav(() => setMobileOpen(false))}
              {lists(() => setMobileOpen(false))}
            </div>
          </aside>
        </>
      )}
    </>
  )
}
