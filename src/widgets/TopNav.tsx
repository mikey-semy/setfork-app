'use client'

import Link from 'next/link'
import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Plus, Sparkles } from 'lucide-react'
import { SearchInput } from '@/shared/ui/SearchInput'
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
  const submitSearch = () => {
    const s = q.trim()
    router.push(s ? `/explore?q=${encodeURIComponent(s)}` : '/explore')
  }
  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href))
  const navLink = (href: string, label: string) => (
    <Link href={href} className={isActive(href) ? 'text-ink' : 'text-ink-2 hover:text-ink'}>
      {label}
    </Link>
  )

  return (
    <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-border bg-surface px-5 py-2.5 print:hidden">
      <Link href="/" className="flex-shrink-0 text-[22px] font-extrabold leading-none tracking-tight text-ink" aria-label="SetFork">
        S<span className="text-accent">F</span>
      </Link>
      <form
        className="max-w-[460px] flex-1"
        onSubmit={(e) => {
          e.preventDefault()
          submitSearch()
        }}
      >
        <SearchInput value={q} onChange={setQ} placeholder={t('searchLists', lang)} inputClassName="py-[7px]" clearLabel={t('clear', lang)} />
      </form>
      <nav className="hidden items-center gap-[22px] text-[13.5px] font-medium sm:flex">
        {navLink('/explore', t('explore', lang))}
        {navLink('/my-lists', t('myLists', lang))}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        {user ? (
          <>
            {/* bell / уведомления (выпадашка + страница «Все») */}
            <NotificationsBell unread={unread} items={notifications} lang={lang} />

            {/* «+» create menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={t('create', lang)}
                  className="grid h-[30px] w-[30px] place-items-center rounded-md bg-primary text-primary-fg"
                >
                  <Plus size={16} />
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
