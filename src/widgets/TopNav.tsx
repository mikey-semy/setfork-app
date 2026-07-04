'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronDown, Plus, Search, Sparkles } from 'lucide-react'
import { NotificationsBell } from '@/features/notifications/NotificationsBell'
import type { NotificationItem } from '@/features/notifications/queries'
import { ThemeToggle } from '@/shared/ui/controls'
import { Avatar } from '@/shared/ui/Avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { t, type Lang } from '@/shared/i18n'
import type { SessionUser } from '@/shared/auth/session'

export function TopNav({
  lang,
  user,
  isAdmin,
  unread = 0,
  notifications = [],
}: {
  lang: Lang
  user: SessionUser | null
  isAdmin?: boolean
  unread?: number
  notifications?: NotificationItem[]
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [q, setQ] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const submitSearch = () => {
    const s = q.trim()
    router.push(s ? `/explore?q=${encodeURIComponent(s)}` : '/explore')
  }
  // Хоткей «/» фокусирует поиск (как на GitHub), если не печатаем в другом поле.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href))
  const navLink = (href: string, label: string) => (
    <Link href={href} className={isActive(href) ? 'text-ink' : 'text-ink-2 hover:text-ink'}>
      {label}
    </Link>
  )
  const iconBtn = 'grid h-8 w-8 place-items-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink'

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-surface px-4 py-2.5 print:hidden">
      <Link href="/" className="flex-shrink-0 text-[22px] font-extrabold leading-none tracking-tight text-ink" aria-label="SetFork">
        S<span className="text-accent">F</span>
      </Link>
      <nav className="hidden items-center gap-5 text-[13.5px] font-medium sm:flex">
        {navLink('/explore', t('explore', lang))}
        {navLink('/my-lists', t('myLists', lang))}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {/* GitHub-подобный поиск: поле с иконкой + подсказка «/» */}
        <form className="hidden md:block" onSubmit={(e) => { e.preventDefault(); submitSearch() }}>
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-[5px] focus-within:border-border-strong">
            <Search size={14} className="shrink-0 text-muted" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('searchTypeSlash', lang)}
              aria-label={t('searchLists', lang)}
              className="w-[180px] bg-transparent text-[13px] text-ink outline-none placeholder:text-muted xl:w-[260px]"
            />
            <kbd className="ml-auto hidden rounded border border-border px-1.5 text-[11px] font-medium leading-[18px] text-muted lg:inline">/</kbd>
          </div>
        </form>
        {/* Мобильный поиск — иконка ведёт в Explore */}
        <Link href="/explore" aria-label={t('searchLists', lang)} className={`${iconBtn} md:hidden`}>
          <Search size={17} />
        </Link>

        {user ? (
          <>
            {/* bell / уведомления (выпадашка + страница «Все») */}
            <NotificationsBell unread={unread} items={notifications} lang={lang} />

            {/* «+» create menu (GitHub-стиль: иконка + chevron) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={t('create', lang)}
                  className="inline-flex h-8 items-center gap-0.5 rounded-md border border-border px-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink"
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
                <button aria-label={user.handle} className="rounded-full outline-none">
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
                <div className="flex items-center justify-between px-2.5 py-1.5">
                  <span className="text-[13px] text-ink-2">{t('theme', lang)}</span>
                  <ThemeToggle />
                </div>
                <DropdownMenuSeparator />
                <form action="/api/auth/logout" method="post">
                  <DropdownMenuItem asChild>
                    <button type="submit" className="w-full text-left text-danger">
                      {t('signOut', lang)}
                    </button>
                  </DropdownMenuItem>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <>
            <ThemeToggle />
            <Link href="/login" className="text-[13px] font-semibold text-ink">
              {t('signIn', lang)}
            </Link>
          </>
        )}
      </div>
    </header>
  )
}
