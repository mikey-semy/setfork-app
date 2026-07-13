'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { ChevronDown, Compass, Home, ListChecks, Menu, PlayCircle, Plus, Search, Sparkles, X } from 'lucide-react'
import { NotificationsBell } from '@/features/notifications/NotificationsBell'
import { QualifierSearch } from '@/features/library/QualifierSearch'
import { MobileSearch } from './MobileSearch'
import type { NotificationItem } from '@/features/notifications/queries'
import { LangSwitch, ThemeModeSwitch, ThemeToggle } from '@/shared/ui/controls'
import { Avatar } from '@/shared/ui/Avatar'
import { ListsPanel } from './ListsPanel'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { t, tr, type Lang, type LocaleText } from '@/shared/i18n'
import type { SessionUser } from '@/shared/auth/session'

// Роуты, чей первый сегмент — НЕ handle пользователя (для бредкрамба в шапке).
const RESERVED_TOP = new Set([
  'explore', 'search', 'settings', 'new', 'generate', 'login', 'register', 'admin', 'runs',
  'notifications', 'api', 'about', 'terms', 'privacy', 'my-lists', 'catalogs',
  'verify-email', 'forgot-password', 'reset-password', 'changelog',
])

/** Списки пользователя для секции «Top lists» в боковом меню (минимум данных). */
export interface TopListItem {
  handle: string
  slug: string
  title: LocaleText
  avatarUrl: string | null
}


export function TopNav({
  lang,
  user,
  isAdmin,
  unread = 0,
  notifications = [],
  topLists = [],
}: {
  lang: Lang
  user: SessionUser | null
  isAdmin?: boolean
  unread?: number
  notifications?: NotificationItem[]
  topLists?: TopListItem[]
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [menuOpen, setMenuOpen] = useState(false)
  // На странице поиска поле в шапке = полноценный квалификатор-поиск во всю ширину.
  const isSearch = pathname.startsWith('/search')
  // Бредкрамб в шапке (как GitHub owner/repo): показываем чей это профиль/список.
  // Первый сегмент — handle, если это не зарезервированный роут; второй — slug списка.
  const crumb = (() => {
    const segs = pathname.split('/').filter(Boolean)
    if (segs.length === 0 || RESERVED_TOP.has(segs[0])) return null
    return { handle: segs[0], slug: segs[1] } // slug undefined на профиле
  })()

  // Имя списка в бредкрамбе = человеческий title, а не slug. Крамб URL-derived (title
  // не знает) → до-достаём по смене пути; пока грузим — показываем slug (мгновенный
  // фолбэк), приватные title гейтит сам роут. Обновляется и на client-навигации.
  const [crumbTitle, setCrumbTitle] = useState<LocaleText | null>(null)
  const crumbHandle = crumb?.handle
  const crumbSlug = crumb?.slug
  useEffect(() => {
    if (!crumbHandle || !crumbSlug) {
      setCrumbTitle(null)
      return
    }
    let alive = true
    setCrumbTitle(null)
    fetch(`/api/list-title?h=${encodeURIComponent(crumbHandle)}&s=${encodeURIComponent(crumbSlug)}`)
      .then((r) => r.json())
      .then((d: { title?: LocaleText | null }) => {
        if (alive) setCrumbTitle(d.title ?? null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [crumbHandle, crumbSlug])
  // Хоткей «/» фокусирует поле поиска в шапке (как на GitHub); Escape закрывает меню.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return setMenuOpen(false)
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return
      e.preventDefault()
      document.querySelector<HTMLInputElement>('header input')?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href))
  // Убираем дефолтный аутлайн (Radix возвращает фокус на триггер после закрытия —
  // из-за этого «залипало» выделение); кольцо оставляем только для клавиатуры.
  const focusRing = 'outline-hidden focus-visible:ring-2 focus-visible:ring-border-strong'
  const iconBtn = `grid h-8 w-8 place-items-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink ${focusRing}`

  // Контекстный заголовок страницы (в шапке — только он, навигация ушла в боковое меню).
  const title = pathname === '/'
    ? t('dashboard', lang)
    : pathname.startsWith('/explore')
      ? t('explore', lang)
      : pathname.startsWith('/my-lists')
        ? t('myLists', lang)
        : pathname.startsWith('/runs')
          ? t('myRuns', lang)
          : pathname.startsWith('/settings')
            ? t('settings', lang)
            : pathname.startsWith('/generate')
              ? t('generateWithAi', lang)
              : pathname.startsWith('/new')
                ? t('newList', lang)
                : pathname.startsWith('/notifications')
                  ? t('notifications', lang)
                  : pathname.startsWith('/admin')
                    ? 'Admin'
                    : ''

  // Пункты бокового меню (глобальная навигация; аккаунт — в меню аватара).
  // Основной блок — навигация; действия (создать/сгенерировать) — отдельной
  // секцией после разделителя, как «create new» у GitHub.
  type NavItem = { href: string; label: string; icon: typeof Home }
  const navItems: NavItem[] = [
    { href: '/', label: t('home', lang), icon: Home },
    { href: '/explore', label: t('explore', lang), icon: Compass },
    ...(user
      ? [
          { href: '/my-lists', label: t('myLists', lang), icon: ListChecks },
          { href: '/runs', label: t('myRuns', lang), icon: PlayCircle },
        ]
      : []),
  ]
  const navLink = (it: NavItem) => (
    <Link
      key={it.href}
      href={it.href}
      onClick={() => setMenuOpen(false)}
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[14px] ${
        isActive(it.href) ? 'bg-surface-2 font-semibold text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
      }`}
    >
      <it.icon size={16} className="shrink-0 text-muted" /> {it.label}
    </Link>
  )

  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-surface px-4 py-2.5 print:hidden">
      {/* Бургер + SF = логотип на одном уровне: ☰ читается как «список», линии жирные */}
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          aria-label={t('menu', lang)}
          onClick={() => setMenuOpen(true)}
          className={`grid h-8 w-8 place-items-center rounded-md text-ink hover:bg-surface-2 ${focusRing}`}
        >
          <Menu size={21} strokeWidth={2.75} />
        </button>
        <Link href="/" className="font-logo text-[19px] leading-none text-ink" aria-label="SetFork">
          SF
        </Link>
      </div>
      {/* Главная навигация — в левом рэйле (SideRail, desktop) и в drawer'е бургера
          (мобилка). В шапке её больше нет — только логотип, бредкрамб и заголовок. */}
      {/* Бредкрамб (как GitHub owner/repo): чей профиль/список открыт. Прячем на поиске.
          Слеша между лого и handle нет — только между handle и slug. */}
      {crumb && !isSearch && (
        <nav className="ml-2 flex min-w-0 items-center gap-1 text-[14px]" aria-label="breadcrumb">
          <Link href={`/${crumb.handle}`} className={`truncate text-ink hover:text-accent ${crumb.slug ? 'font-medium' : 'font-semibold'}`}>
            {crumb.handle}
          </Link>
          {crumb.slug && (
            <>
              <span className="text-muted">/</span>
              <Link href={`/${crumb.handle}/${crumb.slug}`} className="truncate font-semibold text-ink hover:text-accent">
                {crumbTitle ? tr(crumbTitle, lang) : crumb.slug}
              </Link>
            </>
          )}
        </nav>
      )}
      {/* Страница поиска: поле-квалификатор во всю ширину прямо в шапке (как GitHub Search). */}
      {isSearch ? (
        <div className="mx-2 flex min-w-0 flex-1 md:mx-4">
          <QualifierSearch
            key={searchParams.get('q') ?? ''}
            initial={searchParams.get('q') ?? ''}
            scope={searchParams.get('scope')}
            autoFocus={searchParams.get('focus') === '1'}
            lang={lang}
          />
        </div>
      ) : (
        title && <span className="ml-1 truncate text-[15px] font-semibold text-ink">{title}</span>
      )}

      <div className={`flex items-center gap-2 ${isSearch ? '' : 'ml-auto'}`}>
        {/* Небольшой виджет-поиск с подсказками — на всех страницах, КРОМЕ страницы поиска */}
        {!isSearch && (
          <>
            <div className="hidden md:block">
              <QualifierSearch
                lang={lang}
                initial=""
                size="sm"
                containerClassName="w-[220px] xl:w-[300px]"
                hint={
                  <kbd className="hidden rounded border border-border px-1.5 text-[11px] font-medium leading-[18px] text-muted lg:inline">/</kbd>
                }
              />
            </div>
            {/* Мобильный поиск — оверлей на месте (не редирект); на странице списка
                предлагает «искать в этом списке» (?find= — фильтр шагов). */}
            <MobileSearch crumb={crumb} lang={lang} className={`${iconBtn} md:hidden`} />
          </>
        )}

        {user ? (
          <>
            {/* bell / уведомления (выпадашка + страница «Все») */}
            <NotificationsBell unread={unread} items={notifications} lang={lang} />

            {/* «+» create menu (GitHub-стиль: иконка + chevron) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={t('create', lang)}
                  className={`inline-flex h-8 items-center gap-0.5 rounded-md border border-border px-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink ${focusRing}`}
                >
                  <Plus size={16} /> <ChevronDown size={13} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href="/new">
                    <Plus size={15} /> {t('newList', lang)}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/generate">
                    <Sparkles size={15} /> {t('generateWithAi', lang)}
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <span className="mx-0.5 h-5 w-px bg-border" />

            {/* avatar user menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button aria-label={user.handle} className={`rounded-full ${focusRing}`}>
                  <Avatar handle={user.handle} avatarUrl={user.avatarUrl} size={30} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  {t('signedInAs', lang)} <span className="font-semibold text-ink">{user.handle}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href={`/${user.handle}`}>{t('yourProfile', lang)}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/my-lists">{t('myLists', lang)}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/runs">{t('myRuns', lang)}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/${user.handle}?tab=starred`}>{t('starredTab', lang)}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings">{t('settings', lang)}</Link>
                </DropdownMenuItem>
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/admin">Admin</Link>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                  <span className="text-[13px] text-ink-2">{t('theme', lang)}</span>
                  <ThemeModeSwitch />
                </div>
                <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                  <span className="text-[13px] text-ink-2">{t('language', lang)}</span>
                  <LangSwitch lang={lang} />
                </div>
                <DropdownMenuSeparator />
                {/* Логаут через fetch, а НЕ форму: Radix закрывает меню и размонтирует
                    форму раньше, чем уходит submit — из-за этого выйти не получалось. */}
                <DropdownMenuItem
                  className="text-danger"
                  onSelect={() => {
                    void fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
                      window.location.href = '/'
                    })
                  }}
                >
                  {t('signOut', lang)}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <>
            <LangSwitch lang={lang} />
            <ThemeToggle />
            <Link href="/login" className="text-[13px] font-semibold text-ink">
              {t('signIn', lang)}
            </Link>
          </>
        )}
      </div>

      {/* Боковое меню (глобальная навигация), открывается бургером — как на GitHub */}
      {menuOpen && (
        <>
          <div className="animate-fade-in fixed inset-0 z-40 bg-black/40" onClick={() => setMenuOpen(false)} />
          <aside className="animate-slide-in-left fixed left-0 top-0 z-50 flex h-full w-[280px] max-w-[85vw] flex-col border-r border-border bg-surface p-3 shadow-xl">
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="font-logo text-[18px] leading-none text-ink">SF</span>
              <button type="button" aria-label={t('menu', lang)} onClick={() => setMenuOpen(false)} className={iconBtn}>
                <X size={18} />
              </button>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
              {/* Основная навигация (создать/сгенерировать — в топ-баре «+», не дублируем тут) */}
              <nav className="flex flex-col gap-0.5">{navItems.map(navLink)}</nav>

              {/* «Top lists» — общий модуль ListsPanel (как Top repositories у GitHub). */}
              {user && topLists.length > 0 && (
                <>
                  <div className="my-2 border-t border-border/60" />
                  <div className="px-1">
                    <ListsPanel
                      items={topLists}
                      lang={lang}
                      title={t('topLists', lang)}
                      collapsible
                      storageKey="sf.drawer.topLists"
                      searchable
                      showOwner
                      headerStyle="plain"
                      onNavigate={() => setMenuOpen(false)}
                    />
                  </div>
                </>
              )}
            </div>
          </aside>
        </>
      )}
    </header>
  )
}
