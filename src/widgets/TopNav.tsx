'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Plus, Search } from 'lucide-react'
import { LangSwitch, ThemeToggle } from '@/shared/ui/controls'
import { Avatar } from '@/shared/ui/Avatar'
import { t, type Lang } from '@/shared/i18n'
import type { SessionUser } from '@/shared/auth/session'

export function TopNav({ lang, user }: { lang: Lang; user: SessionUser | null }) {
  const pathname = usePathname()
  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href))
  const navLink = (href: string, label: string) => (
    <Link href={href} className={isActive(href) ? 'text-ink' : 'text-ink-2 hover:text-ink'}>
      {label}
    </Link>
  )

  return (
    <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-border bg-surface px-5 py-2.5">
      <Link href="/" className="flex-shrink-0 text-[17px] font-bold tracking-tight text-ink">
        SH
      </Link>
      <Link
        href="/explore"
        className="flex max-w-[460px] flex-1 items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-[7px] text-muted hover:border-border-strong"
      >
        <Search size={15} />
        <span className="truncate text-[13px]">{t('searchLists', lang)}</span>
      </Link>
      <nav className="hidden items-center gap-[22px] text-[13.5px] font-medium sm:flex">
        {navLink('/explore', t('explore', lang))}
        {navLink('/my-lists', t('myLists', lang))}
        {navLink('/runs', t('runs', lang))}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <Link
          href="/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-semibold text-primary-fg"
        >
          <Plus size={14} />
          <span className="hidden sm:inline">{t('newList', lang)}</span>
        </Link>
        <LangSwitch lang={lang} />
        <ThemeToggle />
        {user ? (
          <Link href={`/${user.handle}`} aria-label={user.handle}>
            <Avatar handle={user.handle} avatarUrl={user.avatarUrl} size={30} />
          </Link>
        ) : (
          <Link href="/login" className="text-[13px] font-semibold text-ink">
            {t('signIn', lang)}
          </Link>
        )}
      </div>
    </header>
  )
}
